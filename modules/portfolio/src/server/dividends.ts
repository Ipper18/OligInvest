import {
  Decimal,
  type DividendPlnView,
  type DividendRecord,
  dividendPlnView,
  type IsoDate,
  isoDate,
  type Ledger,
  type Money,
  PIT_CAPITAL_RATE,
  sumDividendPlnViews,
  sumMoney,
  trailingDividends,
  yieldOnCostRatio,
} from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { summarySchema } from "@oliginvest/mod-market/contracts";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createDividendsSchema } from "../dividends-contracts.js";
import { portfolioDate, valuationState } from "../recompute.js";
import { jsonMoney } from "./read-model.js";
import { clean, type PortfolioRepository } from "./repository.js";

const schema = createDividendsSchema();
type Instrument = z.infer<typeof summarySchema>;
type YieldReason = "no_open_position" | "missing_cost" | "missing_cost_pln" | "missing_fx";
export type DividendsInput = {
  accounts: { id: string; currency: string }[];
  /** Ledger replayed up to `to`: dividends paid until then and positions open on `to`. */
  ledger: Pick<Ledger, "dividends" | "positions">;
  instruments: Instrument[];
  from?: IsoDate | undefined;
  to: IsoDate;
  instrumentId?: string | undefined;
  /** NBP table numbers keyed `${base}:${quote}:${date}`. */
  tables: ReadonlyMap<string, string>;
};
const fraction = (value: Decimal) => value.toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toFixed();

/** Orchestrates core § 4.3 (BL-307): amounts stay unrounded until JSON, gaps are null with reasons. */
export function projectDividends(input: DividendsInput, now: Date) {
  const accountIds = new Set(input.accounts.map((a) => a.id));
  const inScope = (r: DividendRecord) =>
    accountIds.has(r.accountId) &&
    (input.instrumentId === undefined || r.instrumentId === input.instrumentId);
  const records = input.ledger.dividends
    .filter((r) => inScope(r) && r.paymentDate <= input.to)
    .filter((r) => input.from === undefined || r.paymentDate >= input.from)
    .toSorted(
      (a, b) =>
        b.paymentDate.localeCompare(a.paymentDate) ||
        a.transactionId.localeCompare(b.transactionId),
    );
  const views = new Map(records.map((r) => [r, dividendPlnView(r)]));
  const instrument = (id: string) => {
    const found = input.instruments.find((i) => i.id === id);
    if (!found) throw new Error("MISSING_INSTRUMENT");
    return found;
  };
  const totals = (list: DividendRecord[]) => {
    const sum = sumDividendPlnViews(list.map((r) => views.get(r) as DividendPlnView));
    return {
      payments: sum.payments,
      grossPln: jsonMoney(sum.grossPln),
      withholdingTaxPln: jsonMoney(sum.withholdingTaxPln),
      netPln: jsonMoney(sum.netPln),
      estimatedTopUpPln: jsonMoney(sum.topUpPln),
      taxablePayments: sum.taxablePayments,
      taxExemptPayments: sum.taxExemptPayments,
      isComplete: sum.isComplete,
    };
  };
  const group = <K>(key: (r: DividendRecord) => K) => {
    const map = new Map<K, DividendRecord[]>();
    for (const r of records) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
    return map;
  };
  const rows = records.map((r) => {
    const view = views.get(r) as DividendPlnView;
    const recorded = r.withholdingRecorded;
    return {
      transactionId: r.transactionId,
      accountId: r.accountId,
      instrument: instrument(r.instrumentId),
      payDate: r.paymentDate,
      gross: jsonMoney(r.gross),
      withholdingTax: recorded ? jsonMoney(r.withholdingTax) : null,
      net: recorded ? jsonMoney(r.net) : null,
      credited: jsonMoney(r.credited),
      grossPln: jsonMoney(view.grossPln),
      withholdingTaxPln: jsonMoney(view.withholdingTaxPln),
      netPln: jsonMoney(view.netPln),
      fxRate: r.rate && {
        rate: r.rate.rate.toDecimalPlaces(10).toFixed(),
        rateDate: r.rate.date,
        source: "nbp" as const,
        tableNo: input.tables.get(`${r.rate.base}:${r.rate.quote}:${r.rate.date}`) ?? null,
      },
      tax: {
        status: view.taxStatus,
        taxDuePln: jsonMoney(view.taxDuePln),
        withholdingCreditPln: jsonMoney(view.withholdingCreditPln),
        estimatedTopUpPln: jsonMoney(view.topUpPln),
      },
      gaps: [...view.gaps],
    };
  });
  const byYear = [...group((r) => Number(r.paymentDate.slice(0, 4)))]
    .sort(([a], [b]) => b - a)
    .map(([year, list]) => ({ year, totals: totals(list) }));
  // Yield on cost (§ 4.3, owner decision 2026-09-24): trailing 12 months of gross in PLN at
  // NBP D-1 over the open FIFO cost in PLN. Cost is in PLN only on a PLN account (Z-29).
  const yieldOf = (instrumentId: string) => {
    const result = (
      reason: YieldReason | null,
      gross: Money | null = null,
      cost: Money | null = null,
    ) => ({
      ratio: reason === null && gross && cost ? fraction(yieldOnCostRatio(gross, cost)!) : null,
      trailingGrossPln: jsonMoney(gross),
      costPln: jsonMoney(cost),
      asOf: input.to,
      reason,
    });
    const positions = input.ledger.positions.filter(
      (p) => p.instrumentId === instrumentId && accountIds.has(p.accountId),
    );
    const trailing = trailingDividends(input.ledger.dividends, {
      asOf: input.to,
      instrumentId,
    }).filter((r) => accountIds.has(r.accountId));
    const grossValues = trailing.map((r) => dividendPlnView(r).grossPln);
    const gross = grossValues.includes(null) ? null : sumMoney(grossValues as Money[], "PLN");
    if (!positions.length) return result("no_open_position", gross);
    if (positions.some((p) => !p.cost)) return result("missing_cost", gross);
    if (positions.some((p) => p.cost!.currency !== "PLN")) return result("missing_cost_pln", gross);
    const cost = sumMoney(
      positions.map((p) => p.cost!),
      "PLN",
    );
    if (!gross) return result("missing_fx", null, cost);
    // A non-positive cost has no defined yield; reported as unknown cost, never 0.
    if (!cost.amount.isPositive() || cost.amount.isZero())
      return result("missing_cost", gross, cost);
    return result(null, gross, cost);
  };
  const byInstrument = [...group((r) => r.instrumentId)]
    .map(([id, list]) => ({
      instrument: instrument(id),
      totals: totals(list),
      yieldOnCost: yieldOf(id),
    }))
    .sort(
      (a, b) =>
        a.instrument.ticker.localeCompare(b.instrument.ticker) ||
        a.instrument.id.localeCompare(b.instrument.id),
    );
  const totalsByCurrency = [...group((r) => r.gross.currency)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, list]) => {
      const recorded = list.every((r) => r.withholdingRecorded);
      const sum = (key: "gross" | "withholdingTax" | "net") =>
        sumMoney(
          list.map((r) => r[key]),
          code,
        );
      return {
        currency: code,
        payments: list.length,
        gross: jsonMoney(sum("gross")),
        withholdingTax: recorded ? jsonMoney(sum("withholdingTax")) : null,
        net: recorded ? jsonMoney(sum("net")) : null,
      };
    });
  const gapCounts = new Map<string, number>();
  for (const view of views.values())
    for (const g of view.gaps) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
  const all = totals(records);
  const status = !records.length ? "no_data" : all.isComplete ? "ok" : "incomplete";
  const rated = records.some((r) => r.rate);
  return schema.parse({
    currency: "PLN",
    from: input.from ?? null,
    to: input.to,
    status,
    rows,
    byYear,
    byInstrument,
    totals: all,
    totalsByCurrency,
    gaps: (["missing_fx", "missing_withholding"] as const).flatMap((reason) =>
      gapCounts.get(reason) ? [{ reason, payments: gapCounts.get(reason)! }] : [],
    ),
    assumptions: {
      incomeDate: "payment_date",
      fxRates: "nbp_table_a_mid_previous_business_day",
      plTaxRate: PIT_CAPITAL_RATE.toFixed(),
      withholdingCredit: "capped_at_pl_rate",
      topUp: "estimate",
      yieldOnCost: "trailing_12m_gross_pln_over_open_cost_pln",
      costBasisMethod: "fifo",
    },
    meta: {
      source: "computed",
      asOf: now.toISOString(),
      delayMinutes: 0,
      stale: status !== "ok",
      ...(status !== "ok" ? { staleReason: "no_data" } : {}),
      ...(rated ? { attribution: "Kursy: NBP" } : {}),
    },
  });
}

export async function readDividends(
  repository: PortfolioRepository,
  context: DatabaseContext,
  query: {
    accountId?: string[] | undefined;
    instrumentId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
) {
  const today = portfolioDate(repository.now()),
    to = isoDate(query.to ?? today),
    from = query.from === undefined ? undefined : isoDate(query.from);
  if (to > today || (from !== undefined && from > to)) throw new ProblemError("VALIDATION_FAILED");
  return repository.read(context, async (tx) => {
    const state = await valuationState(tx, to);
    // RLS hides foreign accounts: an unknown id is 404, never an empty list.
    if (query.accountId?.some((id) => !state.accountRows.some((a) => a.id === id)))
      throw new ProblemError("NOT_FOUND");
    const ids = new Set(
      state.accountRows
        .filter((a) =>
          query.accountId?.length ? query.accountId.includes(a.id) : a.accountType !== "demo",
        )
        .map((a) => a.id),
    );
    const ledger = state.ledgerOn(to);
    const dividends = ledger.dividends.filter((r) => ids.has(r.accountId));
    const instrumentIds = [...new Set(dividends.map((r) => r.instrumentId))];
    const instruments = (
      await tx.execute(
        sql`SELECT id::text,coalesce(ticker,isin,id::text) AS ticker,name,isin,mic,currency,type,country,is_active AS "isActive",exchange_short_name AS "exchangeShortName" FROM market.instruments WHERE id=ANY(${sql.param(instrumentIds)}::uuid[])`,
      )
    ).rows.map((r) => summarySchema.parse(clean(r)));
    const dates = [...new Set(dividends.flatMap((r) => (r.rate ? [r.rate.date] : [])))];
    const tables = new Map(
      (
        await tx.execute(
          sql`SELECT base,quote,rate_date::text AS date,table_no AS "tableNo" FROM market.fx_rates WHERE source='nbp' AND quote='PLN' AND table_no IS NOT NULL AND rate_date=ANY(${sql.param(dates)}::date[])`,
        )
      ).rows.map((r) => {
        const row = z
          .object({ base: z.string(), quote: z.string(), date: z.iso.date(), tableNo: z.string() })
          .strict()
          .parse(r);
        return [`${row.base}:${row.quote}:${row.date}`, row.tableNo] as const;
      }),
    );
    return projectDividends(
      {
        accounts: state.accounts.filter((a) => ids.has(a.id)),
        ledger: {
          dividends,
          positions: ledger.positions.filter((p) => ids.has(p.accountId)),
        },
        instruments,
        from,
        to,
        instrumentId: query.instrumentId,
        tables,
      },
      repository.now(),
    );
  });
}
