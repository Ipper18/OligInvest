import {
  type Decimal,
  money,
  moneyToJson,
  portfolioHistory,
  roundHalfUp,
  type TransactionType,
} from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { portfolioHistorySchema } from "../contracts.js";
import { portfolioDate } from "../recompute.js";
import type { PortfolioRepository } from "./repository.js";

export type HistoryQuery = {
  accountId?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  interval: "1d" | "1w" | "1mo";
  maxPoints: number;
};
const FLOW_TYPES = [
  "DEPOSIT",
  "WITHDRAWAL",
  "CASH_TRANSFER_IN",
  "CASH_TRANSFER_OUT",
  "SECURITY_TRANSFER_IN",
  "SECURITY_TRANSFER_OUT",
] as const satisfies readonly TransactionType[];
const rowSchema = z
  .object({
    accountId: z.uuid(),
    date: z.iso.date(),
    totalValuePln: z.string().nullable(),
    externalFlowPln: z.string().nullable(),
    isComplete: z.boolean(),
    asOf: z.union([z.string(), z.date()]),
  })
  .strict();
// Chart columns are presentation values: Decimal sums are rounded half-up to grosze first (§ 0.2).
const chartNumber = (value: Decimal | null) =>
  value === null ? null : roundHalfUp(value, 2).toNumber();

/** FR-02.10 from stored daily valuations (BL-302); a gap is `null`, never 0. */
export async function readPortfolioHistory(
  repository: PortfolioRepository,
  context: DatabaseContext,
  query: HistoryQuery,
) {
  const today = portfolioDate(repository.now()),
    to = query.to ?? today;
  if (to > today || (query.from !== undefined && query.from > to))
    throw new ProblemError("VALIDATION_FAILED");
  return repository.read(context, async (tx) => {
    const accounts = (
      await tx.execute(sql`SELECT id::text,account_type AS "accountType" FROM portfolio.accounts`)
    ).rows.map((r) => z.object({ id: z.uuid(), accountType: z.string() }).strict().parse(r));
    const ids = accounts
      .filter((a) =>
        query.accountId?.length ? query.accountId.includes(a.id) : a.accountType !== "demo",
      )
      .map((a) => a.id);
    const rows = (
      await tx.execute(
        sql`SELECT account_id::text AS "accountId",valuation_date::text AS date,total_value_pln::text AS "totalValuePln",external_flow_pln::text AS "externalFlowPln",is_complete AS "isComplete",as_of AS "asOf" FROM portfolio.valuations_daily WHERE account_id=ANY(${sql.param(ids)}::uuid[]) AND valuation_date<=${to}::date ORDER BY valuation_date`,
      )
    ).rows.map((r) => rowSchema.parse(r));
    const history = portfolioHistory(rows, {
      from: query.from,
      to,
      interval: query.interval,
      maxPoints: query.maxPoints,
    });
    const first = history.daily[0]?.date,
      last = history.points.at(-1);
    const types = new Map<string, Set<string>>();
    if (first)
      for (const r of (
        await tx.execute(
          sql`SELECT trade_date::text AS date,type FROM portfolio.transactions WHERE account_id=ANY(${sql.param(ids)}::uuid[]) AND trade_date BETWEEN ${first}::date AND ${to}::date AND type=ANY(${sql.param([...FLOW_TYPES])}::text[])`,
        )
      ).rows) {
        const set = types.get(String(r.date)) ?? new Set<string>();
        set.add(String(r.type));
        types.set(String(r.date), set);
      }
    // One marker per day with a non-zero portfolio flow; mixed days fall back to the flow sign.
    const flows = history.daily.flatMap((p) => {
      if (p.flow === null || p.flow.isZero()) return [];
      const day = [...(types.get(p.date) ?? [])];
      const type =
        day.length === 1
          ? (day[0] as TransactionType)
          : p.flow.isNegative()
            ? "WITHDRAWAL"
            : "DEPOSIT";
      return [
        { date: p.date, amount: moneyToJson(money(p.flow, "PLN"), { fractionDigits: 2 }), type },
      ];
    });
    const asOf = rows
      .filter((r) => r.date === last?.date)
      .map((r) => new Date(r.asOf).toISOString())
      .sort()
      .at(-1);
    const stale = !last || last.value === null;
    return portfolioHistorySchema.parse({
      currency: "PLN",
      interval: query.interval,
      t: history.points.map((p) => Date.parse(`${p.date}T00:00:00Z`) / 1000),
      value: history.points.map((p) => chartNumber(p.value)),
      netContributions: history.points.map((p) => chartNumber(p.netContributions)),
      flows,
      decimated: history.decimated,
      meta: {
        source: "computed",
        asOf: asOf ?? repository.now().toISOString(),
        delayMinutes: 0,
        stale,
        ...(stale ? { staleReason: "no_data" } : {}),
      },
    });
  });
}
