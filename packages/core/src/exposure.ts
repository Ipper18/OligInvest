import { type CurrencyCode, currencyCode, PLN } from "./currency.js";
import { type IsoDate, isoDate } from "./dates.js";
import type { Decimal } from "./decimal.js";
import { type PriceFxEffect, sumPriceFxEffects } from "./effects.js";
import { convertMoney, type FxRate, type FxRateTable } from "./fx.js";
import { assertSameCurrency, type Money, sumMoney } from "./money.js";

/** One holding in its own currency: a position (q·price) or a cash balance. */
export interface ExposureItem {
  readonly kind: "security" | "cash";
  readonly currency: string;
  /** Null when the position has no price (valued gap, never 0). */
  readonly value: Money | null;
}

export type ExposureStatus = "ok" | "missing_price" | "missing_fx";

export interface CurrencyExposureSlice {
  readonly currency: CurrencyCode;
  /** Positions and cash in the slice currency; null when a price is missing. */
  readonly valueInCurrency: Money | null;
  /** The same amounts in the reporting currency; null when a price or the rate is missing. */
  readonly securities: Money | null;
  readonly cash: Money | null;
  readonly value: Money | null;
  /** value / total; null unless every slice is known and the total is not zero. */
  readonly weight: Decimal | null;
  /** Slice currency → reporting currency, null for the reporting currency itself. */
  readonly rate: FxRate | null;
  readonly status: ExposureStatus;
}

export interface CurrencyExposure {
  readonly currency: CurrencyCode;
  readonly date: IsoDate;
  readonly slices: readonly CurrencyExposureSlice[];
  /** Σ slice values; null when any slice is incomplete (no partial total, § 4.2.1). */
  readonly total: Money | null;
  readonly isComplete: boolean;
}

/**
 * Currency exposure (obliczenia-finansowe.md § 4.2.1): holdings grouped by their own currency
 * (quote currency of a position, currency of a cash balance), converted with the last rate on or
 * before `date`. Sums are unrounded; a missing price or rate leaves that slice and the total null.
 */
export function currencyExposure(input: {
  readonly items: readonly ExposureItem[];
  readonly fxRates: FxRateTable;
  readonly date: string;
  readonly currency?: string | undefined;
}): CurrencyExposure {
  const date = isoDate(input.date);
  const reporting = currencyCode(input.currency ?? PLN);
  const groups = new Map<CurrencyCode, ExposureItem[]>();
  for (const item of input.items) {
    const code = currencyCode(item.currency);
    if (item.value) assertSameCurrency(code, item.value.currency);
    // A zero cash balance is not an exposure; a zero-valued position still is.
    if (item.kind === "cash" && item.value?.amount.isZero()) continue;
    groups.set(code, [...(groups.get(code) ?? []), item]);
  }
  const codes = [...groups.keys()].sort((a, b) =>
    a === reporting ? -1 : b === reporting ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );
  const partial = codes.map((code) => {
    const items = groups.get(code)!;
    const known = items.every((i) => i.value !== null);
    const rate =
      code === reporting ? null : (input.fxRates.onOrBefore(code, reporting, date) ?? null);
    const convert = (m: Money) => (rate ? convertMoney(m, rate) : m);
    const part = (kind: ExposureItem["kind"]) =>
      sumMoney(
        items.filter((i) => i.kind === kind).map((i) => i.value!),
        code,
      );
    const status: ExposureStatus = !known
      ? "missing_price"
      : code !== reporting && !rate
        ? "missing_fx"
        : "ok";
    const securities = status === "ok" ? convert(part("security")) : null;
    const cash = status === "ok" ? convert(part("cash")) : null;
    return {
      currency: code,
      valueInCurrency: known ? sumMoney([part("security"), part("cash")], code) : null,
      securities,
      cash,
      value: securities && cash ? sumMoney([securities, cash], reporting) : null,
      rate,
      status,
    };
  });
  const isComplete = partial.every((s) => s.status === "ok");
  const total = isComplete
    ? sumMoney(
        partial.map((s) => s.value!),
        reporting,
      )
    : null;
  const slices = partial.map((s) =>
    Object.freeze({
      ...s,
      weight: total && !total.amount.isZero() ? s.value!.amount.div(total.amount) : null,
    }),
  );
  return Object.freeze({
    currency: reporting,
    date,
    slices: Object.freeze(slices),
    total,
    isComplete,
  });
}

/** Price/FX effect totals per instrument currency (§ 4.2); identity holds for every group. */
export function priceFxEffectsByCurrency(
  items: readonly { readonly currency: string; readonly effect: PriceFxEffect }[],
  reporting: string = PLN,
): ReadonlyMap<CurrencyCode, PriceFxEffect> {
  const groups = new Map<CurrencyCode, PriceFxEffect[]>();
  for (const item of items) {
    const code = currencyCode(item.currency);
    groups.set(code, [...(groups.get(code) ?? []), item.effect]);
  }
  return new Map(
    [...groups].map(([code, effects]) => [code, sumPriceFxEffects(effects, reporting)]),
  );
}
