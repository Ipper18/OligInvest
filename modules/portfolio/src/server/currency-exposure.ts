import {
  type CurrencyCode,
  currencyExposure,
  type ExposureItem,
  type FxRate,
  type FxRateTable,
  grossValue,
  type IsoDate,
  isoDate,
  type Ledger,
  type PriceFxEffect,
  priceFxEffectsByCurrency,
  type Quote,
  sumPriceFxEffects,
  valuePortfolio,
} from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createCurrencyExposureSchema } from "../currency-exposure-contracts.js";
import { portfolioDate, valuationState } from "../recompute.js";
import { jsonMoney, positionEffect } from "./read-model.js";
import type { PortfolioRepository } from "./repository.js";

const schema = createCurrencyExposureSchema();
const ATTRIBUTION: Record<string, string> = {
  gpw: "Źródło: GPW",
  yahoo: "Dane: Yahoo Finance",
  nbp: "Kursy: NBP",
  ecb: "Kursy: EBC (Frankfurter)",
};
type Reason = "missing_cost" | "missing_price" | "missing_fx" | "account_currency";
export type CurrencyExposureInput = {
  accounts: Parameters<typeof valuePortfolio>[0]["accounts"];
  ledger: Pick<Ledger, "positions" | "cash">;
  /** EOD closes only (§ 4.2.1), with the bar source for attribution. */
  quotes: (Quote & { source: string })[];
  /** Instrument currency, used when a position has no price. */
  currencies: ReadonlyMap<string, string>;
  fx: FxRateTable;
  date: IsoDate;
  /** NBP table numbers keyed `${base}:${quote}:${date}:${source}`. */
  tables: ReadonlyMap<string, string>;
};
const fraction = (value: { toDecimalPlaces(n: number, r: number): { toFixed(): string } }) =>
  value.toDecimalPlaces(10, 4).toFixed();

/** Orchestrates core § 4.2/§ 4.2.1; amounts stay unrounded until JSON. */
export function projectCurrencyExposure(input: CurrencyExposureInput, now: Date) {
  const { fx, date } = input;
  const valued = valuePortfolio({
    accounts: input.accounts,
    positions: input.ledger.positions,
    cash: input.ledger.cash,
    quotes: input.quotes,
    fxRates: fx,
    date,
  });
  const positions = valued.accounts.flatMap((a) => a.positions);
  const currencyOf = (p: (typeof positions)[number]) =>
    p.price?.currency ?? input.currencies.get(p.instrumentId) ?? "PLN";
  const items: ExposureItem[] = [
    ...positions.map((p) => ({
      kind: "security" as const,
      currency: currencyOf(p),
      value: p.price ? grossValue(p.price, p.quantity) : null,
    })),
    ...input.ledger.cash.map((c) => ({
      kind: "cash" as const,
      currency: c.balance.currency,
      value: c.balance,
    })),
  ];
  const exposure = currencyExposure({ items, fxRates: fx, date });
  const exclusions: {
    accountId: string;
    instrumentId: string;
    currency: string;
    reason: Reason;
  }[] = [];
  const effects: { currency: string; effect: PriceFxEffect }[] = [];
  const scoped = new Set<string>();
  for (const p of positions) {
    const code = currencyOf(p);
    if (code === "PLN") continue;
    const account = input.accounts.find((a) => a.id === p.accountId)!;
    const exclude = (reason: Reason) =>
      exclusions.push({
        accountId: p.accountId,
        instrumentId: p.instrumentId,
        currency: code,
        reason,
      });
    if (account.currency === code) {
      exclude("account_currency");
      continue;
    }
    const original = input.ledger.positions.find(
      (o) => o.accountId === p.accountId && o.instrumentId === p.instrumentId,
    )!;
    const effect = positionEffect(p, original, fx, date);
    // Unknown cost leaves the sums like in positions totals (decision 2026-10-08); a valuation
    // gap (price or rate) makes the whole currency row null.
    if (typeof effect === "string") exclude(effect);
    else effects.push({ currency: code, effect });
    if (typeof effect !== "string" || effect !== "missing_cost") scoped.add(code);
  }
  const sums = priceFxEffectsByCurrency(effects);
  const incomplete = new Set(
    exclusions
      .filter((e) => e.reason === "missing_price" || e.reason === "missing_fx")
      .map((e) => e.currency),
  );
  const rows = [...scoped].sort().map((code) => {
    const sum = incomplete.has(code) ? null : (sums.get(code as CurrencyCode) ?? null);
    return {
      currency: code,
      status: incomplete.has(code) ? ("incomplete" as const) : ("ok" as const),
      positions: effects.filter((e) => e.currency === code).length,
      unrealizedPl: jsonMoney(sum?.pl ?? null),
      priceEffect: jsonMoney(sum?.priceEffect ?? null),
      fxEffect: jsonMoney(sum?.fxEffect ?? null),
    };
  });
  const total = sumPriceFxEffects(
    effects.filter((e) => !incomplete.has(e.currency)).map((e) => e.effect),
    "PLN",
  );
  const rate = (r: FxRate | null) =>
    r && {
      rate: r.rate.toDecimalPlaces(10).toFixed(),
      rateDate: r.date,
      source: r.source === "nbp" || r.source === "ecb" ? r.source : ("derived" as const),
      tableNo: input.tables.get(`${r.base}:${r.quote}:${r.date}:${r.source}`) ?? null,
    };
  const status = !exposure.slices.length ? "no_data" : exposure.isComplete ? "ok" : "incomplete";
  const used = input.quotes.filter((q) => positions.some((p) => p.instrumentId === q.instrumentId));
  const sources = [
    ...new Set([
      ...used.map((q) => q.source),
      ...exposure.slices.flatMap((s) => (s.rate ? [s.rate.source] : [])),
    ]),
  ];
  const stale = status !== "ok";
  return schema.parse({
    currency: "PLN",
    date,
    status,
    total: status === "ok" ? jsonMoney(exposure.total) : null,
    slices: exposure.slices.map((s) => ({
      currency: s.currency,
      status: s.status,
      valueInCurrency: jsonMoney(s.valueInCurrency),
      securities: jsonMoney(s.securities),
      cash: jsonMoney(s.cash),
      value: jsonMoney(s.value),
      weight: s.weight ? fraction(s.weight) : null,
      fxRate: rate(s.rate),
    })),
    decomposition: {
      rows,
      total: {
        unrealizedPl: jsonMoney(total.pl),
        priceEffect: jsonMoney(total.priceEffect),
        fxEffect: jsonMoney(total.fxEffect),
      },
      isComplete: incomplete.size === 0,
      exclusions,
    },
    assumptions: {
      grouping: "holding_currency",
      prices: "eod_close",
      fxRates: "nbp_table_a_mid",
      view: "economic",
      costBasisMethod: "fifo",
    },
    meta: {
      source: "computed",
      asOf: valued.asOf ?? now.toISOString(),
      delayMinutes: 0,
      stale,
      staleReason: stale ? "no_data" : "eod_only",
      ...(sources.length
        ? {
            attribution: sources
              .flatMap((s) => (ATTRIBUTION[s] ? [ATTRIBUTION[s]] : []))
              .join(" · "),
          }
        : {}),
    },
  });
}

export async function readCurrencyExposure(
  repository: PortfolioRepository,
  context: DatabaseContext,
  query: { accountId?: string[] | undefined; asOf?: string | undefined },
) {
  const today = portfolioDate(repository.now()),
    date = isoDate(query.asOf ?? today);
  if (date > today) throw new ProblemError("VALIDATION_FAILED");
  return repository.read(context, async (tx) => {
    const state = await valuationState(tx, date);
    // RLS hides foreign accounts: an unknown id is 404, never an empty portfolio.
    if (query.accountId?.some((id) => !state.accountRows.some((a) => a.id === id)))
      throw new ProblemError("NOT_FOUND");
    const ids = new Set(
      state.accountRows
        .filter((a) =>
          query.accountId?.length ? query.accountId.includes(a.id) : a.accountType !== "demo",
        )
        .map((a) => a.id),
    );
    const ledger = state.ledgerOn(date);
    const selected = {
      positions: ledger.positions.filter((p) => ids.has(p.accountId)),
      cash: ledger.cash.filter((c) => ids.has(c.accountId)),
    };
    const instrumentIds = [...new Set(selected.positions.map((p) => p.instrumentId))];
    const currencies = new Map(
      (
        await tx.execute(
          sql`SELECT id::text,currency FROM market.instruments WHERE id=ANY(${sql.param(instrumentIds)}::uuid[])`,
        )
      ).rows.map((r) => {
        const row = z.object({ id: z.uuid(), currency: z.string() }).strict().parse(r);
        return [row.id, row.currency] as const;
      }),
    );
    const quotes = state
      .quotesOn(date)
      .filter((q) => instrumentIds.includes(q.instrumentId))
      .map((q) => ({
        ...q,
        source: state.bars.findLast((b) => b.id === q.instrumentId && b.date <= date)!.source,
      }));
    const tables = new Map(
      (
        await tx.execute(
          sql`SELECT base,quote,rate_date::text AS date,source,table_no AS "tableNo" FROM market.fx_rates WHERE table_no IS NOT NULL AND rate_date<=${date}::date AND rate_date>=${date}::date - 31 AND (base='PLN' OR quote='PLN')`,
        )
      ).rows.map((r) => {
        const row = z
          .object({
            base: z.string(),
            quote: z.string(),
            date: z.iso.date(),
            source: z.string(),
            tableNo: z.string(),
          })
          .strict()
          .parse(r);
        return [`${row.base}:${row.quote}:${row.date}:${row.source}`, row.tableNo] as const;
      }),
    );
    return projectCurrencyExposure(
      {
        accounts: state.accounts.filter((a) => ids.has(a.id)),
        ledger: selected,
        quotes,
        currencies,
        fx: state.fx,
        date,
        tables,
      },
      repository.now(),
    );
  });
}
