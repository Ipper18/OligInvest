import { type CurrencyCode, currencyCode, PLN } from "./currency.js";
import { type IsoDate, isoDate } from "./dates.js";
import { Decimal, type DecimalInput, toDecimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import { assertSameCurrency, type Money, money } from "./money.js";

/** `nbp` — table A mid; `broker` — rate applied by the broker; `derived` — identity/cross rate. */
export type FxRateSource =
  | "nbp"
  | "ecb"
  | "broker"
  | "implied"
  | "nbp_fallback"
  | "manual"
  | "derived";

const SOURCES: ReadonlySet<string> = new Set([
  "nbp",
  "ecb",
  "broker",
  "implied",
  "nbp_fallback",
  "manual",
  "derived",
]);

/** `rate` = units of `quote` for one `base` (USD→PLN 3.9800), obliczenia-finansowe.md § 0.1. */
export interface FxRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  readonly rate: Decimal;
  readonly date: IsoDate;
  readonly source: FxRateSource;
}

export interface FxRateInput {
  readonly base: string;
  readonly quote: string;
  readonly rate: DecimalInput;
  readonly date: string;
  readonly source: FxRateSource;
}

export function fxRate(input: FxRateInput): FxRate {
  const base = currencyCode(input.base);
  const quote = currencyCode(input.quote);
  const rate = toDecimal(input.rate);
  const date = isoDate(input.date);
  if (!rate.isPositive() || rate.isZero()) {
    throw new CoreError("invalid_fx_rate", "FX rate must be positive");
  }
  if (base === quote && !rate.equals(1)) {
    throw new CoreError("invalid_fx_rate", "Identity rate must equal 1", { base });
  }
  if (!SOURCES.has(input.source)) {
    throw new CoreError("invalid_fx_rate", "Unknown FX rate source", {
      source: String(input.source),
    });
  }
  if (base === quote && input.source !== "derived") {
    throw new CoreError("invalid_fx_rate", "Identity rate must be derived", { base });
  }
  return Object.freeze({ base, quote, rate, date, source: input.source });
}

export function convertMoney(amount: Money, rate: FxRate): Money {
  assertSameCurrency(rate.base, amount.currency);
  return money(amount.amount.times(rate.rate), rate.quote);
}

export function invertFxRate(rate: FxRate): FxRate {
  return fxRate({
    base: rate.quote,
    quote: rate.base,
    rate: new Decimal(1).div(rate.rate),
    date: rate.date,
    source: rate.source,
  });
}

function validMargin(margin: DecimalInput): Decimal {
  const m = toDecimal(margin);
  if (m.isNegative() || m.greaterThanOrEqualTo(1)) {
    throw new CoreError("invalid_fx_rate", "FX margin must be in [0, 1)");
  }
  return m;
}

/**
 * Broker rate from the mid rate (§ 2.1): `buy` — the account buys the base currency (instrument
 * purchase), mid·(1 + m); `sell` — it sells the base currency (sale, dividend), mid·(1 − m).
 */
export function brokerFxRate(mid: FxRate, margin: DecimalInput, side: "buy" | "sell"): FxRate {
  const m = validMargin(margin);
  const factor = side === "buy" ? new Decimal(1).plus(m) : new Decimal(1).minus(m);
  return fxRate({
    base: mid.base,
    quote: mid.quote,
    rate: mid.rate.times(factor),
    date: mid.date,
    source: "broker",
  });
}

/** Economic FX conversion cost q·p·mid·m in the quote currency (§ 2.1). */
export function fxConversionCost(gross: Money, mid: FxRate, margin: DecimalInput): Money {
  const m = validMargin(margin);
  return money(convertMoney(gross, mid).amount.times(m), mid.quote);
}

/** Pure lookup over preloaded rates (e.g. NBP table A); the caller does all I/O. */
export interface FxRateTable {
  /** Last rate published on or before `date` (valuation, carry-forward on days without a table). */
  onOrBefore(base: string, quote: string, date: string): FxRate | undefined;
  /** Last rate published strictly before `date` (tax view: NBP from the previous business day). */
  before(base: string, quote: string, date: string): FxRate | undefined;
}

type Pick = (rates: readonly FxRate[], date: IsoDate) => FxRate | undefined;

function lastWhere(rates: readonly FxRate[], accept: (rateDate: IsoDate) => boolean) {
  let low = 0;
  let high = rates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (accept((rates[middle] as FxRate).date)) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? undefined : rates[low - 1];
}

const pickOnOrBefore: Pick = (rates, date) => lastWhere(rates, (d) => d <= date);
const pickBefore: Pick = (rates, date) => lastWhere(rates, (d) => d < date);

export function createFxRateTable(rates: readonly FxRate[]): FxRateTable {
  const byPair = new Map<string, FxRate[]>();
  for (const rate of rates) {
    const key = `${rate.base}/${rate.quote}`;
    const list = byPair.get(key) ?? [];
    list.push(rate);
    byPair.set(key, list);
  }
  for (const [key, list] of byPair) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 1; i < list.length; i += 1) {
      if ((list[i] as FxRate).date === (list[i - 1] as FxRate).date) {
        throw new CoreError("duplicate_fx_rate", "Duplicate FX rate for the same pair and day", {
          pair: key,
          date: (list[i] as FxRate).date,
        });
      }
    }
  }

  function direct(base: string, quote: string, date: IsoDate, pick: Pick): FxRate | undefined {
    const found = byPair.get(`${base}/${quote}`);
    if (found) {
      const rate = pick(found, date);
      if (rate) return rate;
    }
    const inverse = byPair.get(`${quote}/${base}`);
    const rate = inverse ? pick(inverse, date) : undefined;
    return rate ? invertFxRate(rate) : undefined;
  }

  function resolve(base: string, quote: string, date: string, pick: Pick): FxRate | undefined {
    const b = currencyCode(base);
    const q = currencyCode(quote);
    const d = isoDate(date);
    if (b === q) return fxRate({ base: b, quote: q, rate: "1", date: d, source: "derived" });
    const found = direct(b, q, d, pick);
    if (found || b === PLN || q === PLN) return found;
    const baseToPln = direct(b, PLN, d, pick);
    const quoteToPln = direct(q, PLN, d, pick);
    if (!baseToPln || !quoteToPln) return undefined;
    return fxRate({
      base: b,
      quote: q,
      rate: baseToPln.rate.div(quoteToPln.rate),
      date: baseToPln.date < quoteToPln.date ? baseToPln.date : quoteToPln.date,
      source: baseToPln.source === quoteToPln.source ? baseToPln.source : "derived",
    });
  }

  return Object.freeze({
    onOrBefore: (base: string, quote: string, date: string) =>
      resolve(base, quote, date, pickOnOrBefore),
    before: (base: string, quote: string, date: string) => resolve(base, quote, date, pickBefore),
  });
}
