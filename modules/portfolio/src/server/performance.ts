import type { ReturnFigures } from "@oliginvest/contracts";
import {
  type AccountValuationRow,
  addDays,
  convertMoney,
  Decimal,
  externalFlows,
  grossValue,
  investorCashflows,
  isoDate,
  money,
  PERIOD_KEYS,
  periodStart,
  portfolioHistory,
  sumMoney,
  timeWeightedReturn,
  xirr,
} from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createPerformanceSchema } from "../performance-contracts.js";
import { portfolioDate, valuationState } from "../recompute.js";
import type { PortfolioRepository } from "./repository.js";

const performanceSchema = createPerformanceSchema();

export type PerformanceQuery = {
  accountId?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  currency: "base" | "account";
  instrumentId?: string | undefined;
  benchmarkId?: string | undefined;
};
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
type Row = AccountValuationRow & { asOf: string | Date };
const unavailable: ReturnFigures = {
  twr: null,
  twrAnnualized: null,
  xirr: null,
  xirrStatus: "insufficient_flows",
};
const rate = (value: number | null) => (value === null ? null : new Decimal(value).toFixed());

/** Orchestrates the core functions; no duplicate return formulas and no sampled chart series. */
export function performanceFromRows(
  rows: readonly Row[],
  currency: string,
  query: { from?: string | undefined; to: string },
  now: Date,
) {
  const history = portfolioHistory(rows, { to: query.to, interval: "1d", maxPoints: 3000 }).daily;
  const first = history[0]?.date,
    last = history.at(-1);
  const to = last?.date ?? isoDate(query.to);
  const from = isoDate(
    query.from && (!first || query.from > first) ? query.from : (first ?? query.to),
  );
  const starts = new Map<string, string>();
  for (const row of rows)
    if (!starts.has(row.accountId) || row.date < starts.get(row.accountId)!)
      starts.set(row.accountId, row.date);
  const present = new Set(rows.map((r) => `${r.accountId}:${r.date}`));
  const figures = (start: string): ReturnFigures => {
    if (!first || !last || start > to) return unavailable;
    const base = addDays(start, -1);
    const points = history.filter((p) => p.date >= base && p.date <= to);
    const inception = start <= first;
    if (!points.length || (!inception && points[0]?.date !== base)) return unavailable;
    if (
      points.some(
        (p, i) =>
          p.value === null ||
          p.flow === null ||
          (i > 0 && p.date !== addDays(points[i - 1]!.date, 1)) ||
          [...starts].some(([id, date]) => date <= p.date && !present.has(`${id}:${p.date}`)),
      )
    )
      return unavailable;
    const input = points.map((p) => ({
      date: p.date,
      value: money(p.value!, currency),
      flow: money(p.flow!, currency),
    }));
    const twr = timeWeightedReturn(input, inception ? {} : { from: base, to });
    const flows = points
      .filter((p) => p.date >= start && !p.flow!.isZero())
      .map((p) => ({ date: p.date, amount: money(p.flow!, currency) }));
    const irr = xirr(
      investorCashflows({
        start: {
          date: inception ? first : base,
          value: money(inception ? "0" : points[0]!.value!, currency),
        },
        flows,
        end: { date: to, value: money(last.value!, currency) },
      }),
    );
    return {
      twr: rate(twr.twr),
      twrAnnualized: rate(twr.annualized),
      xirr: rate(irr.rate),
      xirrStatus: irr.status,
    };
  };
  const total = figures(from);
  const stale = !last || total.twr === null || to < query.to;
  const asOf = rows
    .filter((r) => r.date === to)
    .map((r) => new Date(r.asOf).toISOString())
    .sort()[0];
  return performanceSchema.parse({
    currency,
    from,
    to: from > to ? from : to,
    total,
    periods: PERIOD_KEYS.map((key) => ({
      key,
      ...figures(first ? addDays(periodStart(key, to, first), 1) : from),
    })),
    assumptions: { flowTiming: "start_of_day", dayCount: "ACT/365" },
    meta: {
      source: "computed",
      asOf: asOf ?? now.toISOString(),
      delayMinutes: 0,
      stale,
      staleReason: stale ? "no_data" : "eod_only",
    },
  });
}

export async function readPerformance(
  repository: PortfolioRepository,
  context: DatabaseContext,
  query: PerformanceQuery,
) {
  const today = portfolioDate(repository.now()),
    to = query.to ?? today;
  if (to > today || (query.from && query.from > to) || query.instrumentId || query.benchmarkId)
    throw new ProblemError("VALIDATION_FAILED");
  return repository.read(context, async (tx) => {
    const accounts = (
      await tx.execute(
        sql`SELECT a.id::text,a.account_type AS "accountType",a.currency,(SELECT min(t.trade_date)::text FROM portfolio.transactions t WHERE t.account_id=a.id) AS "firstDate" FROM portfolio.accounts a`,
      )
    ).rows.map((r) =>
      z
        .object({
          id: z.uuid(),
          accountType: z.string(),
          currency: z.string(),
          firstDate: z.iso.date().nullable(),
        })
        .strict()
        .parse(r),
    );
    if (query.accountId?.some((id) => !accounts.some((a) => a.id === id)))
      throw new ProblemError("NOT_FOUND");
    const selected = accounts.filter((a) =>
      query.accountId?.length ? query.accountId.includes(a.id) : a.accountType !== "demo",
    );
    if (query.currency === "account" && selected.length !== 1)
      throw new ProblemError("VALIDATION_FAILED");
    const currency = query.currency === "account" ? selected[0]!.currency : "PLN";
    const valueColumn = query.currency === "account" ? sql`total_value` : sql`total_value_pln`;
    const flowColumn = query.currency === "account" ? sql`external_flow` : sql`external_flow_pln`;
    const rows = (
      await tx.execute(
        sql`SELECT account_id::text AS "accountId",valuation_date::text AS date,${valueColumn}::text AS "totalValuePln",${flowColumn}::text AS "externalFlowPln",is_complete AS "isComplete",as_of AS "asOf" FROM portfolio.valuations_daily WHERE account_id=ANY(${sql.param(selected.map((a) => a.id))}::uuid[]) AND valuation_date<=${to}::date ORDER BY valuation_date`,
      )
    ).rows.map((r) => rowSchema.parse(r));
    // An account awaiting its first recompute must not silently disappear from the total.
    for (const account of selected) {
      if (
        account.firstDate &&
        account.firstDate <= to &&
        !rows.some((r) => r.accountId === account.id && r.date === account.firstDate)
      ) {
        rows.push({
          accountId: account.id,
          date: account.firstDate,
          totalValuePln: null,
          externalFlowPln: null,
          isComplete: false,
          asOf: repository.now(),
        });
      }
    }
    // Stored F_d is per account. Paired transfers are internal to a selected group even when
    // their legs occur on different days or use different currencies (§ 0.4). Delegate their
    // classification and conversion to core; ordinary reads use only the stored daily series.
    if (selected.length > 1) {
      const ids = selected.map((a) => a.id);
      const linked =
        (
          await tx.execute(
            sql`SELECT 1 FROM portfolio.transactions a JOIN portfolio.transactions b ON (a.related_transaction_id=b.id OR b.related_transaction_id=a.id) WHERE a.account_id=ANY(${sql.param(ids)}::uuid[]) AND b.account_id=ANY(${sql.param(ids)}::uuid[]) AND a.type IN ('CASH_TRANSFER_IN','CASH_TRANSFER_OUT','SECURITY_TRANSFER_IN','SECURITY_TRANSFER_OUT') LIMIT 1`,
          )
        ).rows.length > 0;
      if (linked) {
        const state = await valuationState(tx, to),
          unknown = new Set<string>();
        const flows = externalFlows(
          state.transactions.filter((t) => ids.includes(t.accountId)),
          {
            level: "portfolio",
            securityTransferValue: (t) => {
              if (!("instrumentId" in t) || !("quantity" in t)) return undefined;
              const quote = state
                .quotesOn(t.tradeDate)
                .find((q) => q.instrumentId === t.instrumentId);
              if (quote) return grossValue(quote.price, t.quantity);
              unknown.add(t.id);
              return money("0", currency);
            },
          },
        );
        const grouped = new Map<string, typeof flows>();
        for (const flow of flows) {
          const key = `${flow.accountId}:${flow.date}`;
          const group = grouped.get(key) ?? [];
          group.push(flow);
          grouped.set(key, group);
        }
        for (const row of rows) {
          let complete = true;
          const amounts = (grouped.get(`${row.accountId}:${row.date}`) ?? []).flatMap((flow) => {
            const fx = state.fx.onOrBefore(flow.amount.currency, currency, flow.date);
            if (!fx || unknown.has(flow.transactionId)) {
              complete = false;
              return [];
            }
            return [convertMoney(flow.amount, fx)];
          });
          row.externalFlowPln = complete ? sumMoney(amounts, currency).amount.toFixed() : null;
        }
      }
    }
    return performanceFromRows(rows, currency, { from: query.from, to }, repository.now());
  });
}
