import { minorUnits } from "./currency.js";
import { Decimal, roundHalfUp } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { FxRate } from "./fx.js";
import type { Money, Price, Quantity } from "./money.js";

/**
 * pl-PL formatting (system-projektowy.md § 5). Values are rounded ROUND_HALF_UP with decimal.js
 * and handed to Intl as exact decimal strings, so no amount ever passes through a float.
 */
const LOCALE = "pl-PL";
const cache = new Map<string, Intl.NumberFormat>();

type SignDisplay = "auto" | "exceptZero" | "always" | "never";

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let cached = cache.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, cached);
  }
  return cached;
}

function digits(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 0 || result > 20) {
    throw new CoreError("invalid_format", "Fraction digits must be an integer from 0 to 20");
  }
  return result;
}

function exact(value: Decimal, fractionDigits: number, fixed: boolean): `${number}` {
  const rounded = roundHalfUp(value, fractionDigits);
  const unsigned = rounded.isZero() ? rounded.abs() : rounded;
  return (fixed ? unsigned.toFixed(fractionDigits) : unsigned.toFixed()) as `${number}`;
}

function currencyText(
  amount: Decimal,
  currency: string,
  fractionDigits: number,
  signDisplay: SignDisplay,
): string {
  return formatter({
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    signDisplay,
  }).format(exact(amount, fractionDigits, true));
}

export interface MoneyFormatOptions {
  readonly signDisplay?: SignDisplay;
  readonly fractionDigits?: number;
}

/** `1234,56 zł`, `12 345,67 zł`, `1234,50 USD`; `signDisplay: 'exceptZero'` for changes. */
export function formatMoney(value: Money, options: MoneyFormatOptions = {}): string {
  const places = digits(options.fractionDigits, minorUnits(value.currency));
  return currencyText(value.amount, value.currency, places, options.signDisplay ?? "auto");
}

/** Unit price with the quote precision from instrument data (default 2). */
export function formatPrice(value: Price, options: { fractionDigits?: number } = {}): string {
  return currencyText(value.amount, value.currency, digits(options.fractionDigits, 2), "auto");
}

/** Up to 4 decimal places without trailing zeros (fractional shares). */
export function formatQuantity(
  value: Quantity,
  options: { maxFractionDigits?: number } = {},
): string {
  const places = digits(options.maxFractionDigits, 4);
  return formatter({ minimumFractionDigits: 0, maximumFractionDigits: places }).format(
    exact(value, places, false),
  );
}

/** FX rates with 4 places, as in NBP table A. */
export function formatFxRate(value: FxRate | Decimal, options: { fractionDigits?: number } = {}) {
  const places = digits(options.fractionDigits, 4);
  const rate = Decimal.isDecimal(value) ? value : value.rate;
  return formatter({ minimumFractionDigits: places, maximumFractionDigits: places }).format(
    exact(rate, places, true),
  );
}

export interface RatioFormatOptions {
  readonly fractionDigits?: number;
  readonly signDisplay?: SignDisplay;
}

/**
 * Ratio (fraction, § 0.1) as percent: `0,54%`. Non-zero values below the display precision
 * render as a bound (`< 0,01%`, `> -0,01%`) instead of a misleading zero (§ 0.2).
 */
export function formatRatio(value: number | Decimal, options: RatioFormatOptions = {}): string {
  const ratio = new Decimal(value);
  if (!ratio.isFinite()) throw new CoreError("invalid_decimal", "Ratio must be finite");
  const places = digits(options.fractionDigits, 2);
  const percent = (r: Decimal, signDisplay: SignDisplay) =>
    formatter({
      style: "percent",
      minimumFractionDigits: places,
      maximumFractionDigits: places,
      signDisplay,
    }).format(exact(r, places + 2, true));
  const threshold = new Decimal(10).pow(-(places + 2));
  if (!ratio.isZero() && ratio.abs().lessThan(threshold)) {
    return ratio.isNegative()
      ? `> ${percent(threshold.negated(), "auto")}`
      : `< ${percent(threshold, "auto")}`;
  }
  return percent(ratio, options.signDisplay ?? "auto");
}
