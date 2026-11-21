import { targetWeightSchema } from "@oliginvest/contracts";
import { allocationDrift, toDecimal } from "@oliginvest/core";
import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { dayChangeResponse } from "../contracts.js";
import { portfolioDate } from "../recompute.js";
import { readDrawdown } from "./drawdown.js";
import { readPortfolio } from "./read-service.js";
import type { PortfolioRepository } from "./repository.js";

export async function readAlertObservation(
  tx: DatabaseTransaction,
  userId: string,
  type: "portfolio_change" | "drawdown" | "allocation_drift",
  targetId: string | undefined,
  now: Date,
) {
  const context = { userId, role: "user" as const };
  const repo: Pick<PortfolioRepository, "read" | "now"> = {
    now: () => now,
    read: (_context, work) => work(tx),
  };
  const date = portfolioDate(now);
  const blocked = await tx.execute(
    sql`SELECT 1 FROM portfolio.positions_daily p JOIN market.data_quality_issues d USING(instrument_id) WHERE p.valuation_date=${date}::date AND d.status='open' AND d.severity='BLOCK' LIMIT 1`,
  );
  if (blocked.rows.length) return null;
  if (type === "portfolio_change") {
    const data = dayChangeResponse.parse(
      await readPortfolio(repo, context, "getDayChange", { asOf: date }),
    );
    return data.meta.stale || data.changeRatio === null
      ? null
      : { value: String(data.changeRatio), asOf: data.meta.asOf };
  }
  if (type === "drawdown") {
    const data = await readDrawdown(repo, context, { to: date, maxPoints: 3000 });
    const value = data.underwater.drawdown.at(-1);
    return data.meta.stale || value === undefined ? null : { value, asOf: data.meta.asOf };
  }
  const [target] = (
    await tx.execute(
      sql`SELECT targets,account_id FROM portfolio.target_allocations WHERE id=${targetId}::uuid`,
    )
  ).rows;
  if (!target) return null;
  const scope = target.account_id
    ? sql`a.id=${target.account_id}::uuid`
    : sql`a.account_type <> 'demo'`;
  const [valuation] = (
    await tx.execute(sql`SELECT sum(v.total_value_pln)::text AS total, sum(v.cash*v.fx_rate_to_pln)::text AS cash,min(v.as_of) AS as_of,
 bool_and(coalesce(v.is_complete AND v.total_value_pln IS NOT NULL AND v.fx_rate_to_pln IS NOT NULL,false)) AS complete
 FROM portfolio.accounts a LEFT JOIN portfolio.valuations_daily v ON v.account_id=a.id AND v.valuation_date=${date}::date WHERE ${scope} AND EXISTS(SELECT 1 FROM portfolio.transactions t WHERE t.account_id=a.id AND t.trade_date<=${date}::date)`)
  ).rows;
  if (!valuation?.complete || valuation.total == null || valuation.cash == null) return null;
  const rows = (
    await tx.execute(
      sql`SELECT p.instrument_id,coalesce(o.asset_class,i.asset_class) AS class,p.market_value_pln::text AS amount FROM portfolio.positions_daily p JOIN portfolio.accounts a ON a.id=p.account_id JOIN market.instruments i ON i.id=p.instrument_id LEFT JOIN portfolio.instrument_overrides o ON o.instrument_id=p.instrument_id WHERE ${scope} AND p.valuation_date=${date}::date`,
    )
  ).rows;
  const amounts = new Map<string, string>([["cash", String(valuation.cash)]]);
  for (const row of rows) {
    if (row.amount == null) return null;
    for (const key of [String(row.instrument_id), String(row.class)])
      amounts.set(
        key,
        toDecimal(amounts.get(key) ?? "0")
          .plus(String(row.amount))
          .toFixed(),
      );
  }
  const weights = z
    .array(targetWeightSchema)
    .parse(target.targets)
    .map((w) => ({ key: w.instrumentId ?? w.assetClass!, weight: w.weight }));
  const value = allocationDrift(String(valuation.total), weights, amounts);
  return value === null
    ? null
    : { value, asOf: z.coerce.date().parse(valuation.as_of).toISOString() };
}
