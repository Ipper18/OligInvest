import { Decimal } from "decimal.js";

export type DecimalInput = string | Decimal;
export type CurrencyCode = "PLN" | "USD" | "EUR";
const LOCALE = "pl-PL";
const DEFAULT_TIME_ZONE = "Europe/Warsaw";
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormat = new Intl.RelativeTimeFormat(LOCALE);

function decimalText(value: DecimalInput): string {
  if (typeof value !== "string" && !Decimal.isDecimal(value)) {
    throw new TypeError("Expected a decimal string or Decimal, never number");
  }
  const text = value.toString();
  if (!/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(text)) {
    throw new TypeError("Expected a finite decimal value");
  }
  return text;
}

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let format = numberFormats.get(key);
  if (!format) {
    // ECMA-402 halfExpand is ROUND_HALF_UP, including negative ties.
    format = new Intl.NumberFormat(LOCALE, { roundingMode: "halfExpand", ...options });
    numberFormats.set(key, format);
  }
  return format;
}

function number(value: DecimalInput, options: Intl.NumberFormatOptions): string {
  // Intl accepts exact decimal strings; never coerce through Number/parseFloat.
  // TS's Intl declaration omits ECMA-402 ToIntlMathematicalValue(string).
  const format = numberFormat(options).format as ((value: string) => string) &
    Intl.NumberFormat["format"];
  return format(decimalText(value));
}

function currencyOptions(currency: CurrencyCode): Intl.NumberFormatOptions {
  if (!["PLN", "USD", "EUR"].includes(currency)) throw new RangeError("Unsupported currency");
  return { style: "currency", currency, currencyDisplay: currency === "PLN" ? "symbol" : "code" };
}

export function formatMoney(
  amount: DecimalInput,
  currency: CurrencyCode,
  options: { signed?: boolean; compact?: boolean } = {},
): string {
  return number(amount, {
    ...currencyOptions(currency),
    notation: options.compact ? "compact" : "standard",
    minimumFractionDigits: options.compact ? 0 : 2,
    maximumFractionDigits: options.compact ? 1 : 2,
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
}

export function formatPrice(value: DecimalInput, currency: CurrencyCode, digits: number): string {
  return number(value, {
    ...currencyOptions(currency),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatQuantity(value: DecimalInput): string {
  return number(value, { maximumFractionDigits: 4 });
}

/** Ratios, e.g. "0.0054" -> "0,54%". */
export function formatPercent(
  value: DecimalInput,
  options: { digits?: 1 | 2; signed?: boolean } = {},
): string {
  return number(value, {
    style: "percent",
    minimumFractionDigits: options.digits ?? 2,
    maximumFractionDigits: options.digits ?? 2,
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
}

export function formatRatio(value: DecimalInput): string {
  return number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatFxRate(value: DecimalInput): string {
  return number(value, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function formatCompact(value: DecimalInput): string {
  return number(value, { notation: "compact", maximumFractionDigits: 1 });
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE, options);
    dateFormats.set(key, format);
  }
  return format;
}

/** Civil/session date, intentionally independent of the user's timezone. */
export function formatDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new TypeError("Expected an ISO civil date");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid civil date");
  return dateFormat({ dateStyle: "short", timeZone: "UTC" }).format(date);
}

function instant(value: string | Date): Date {
  if (typeof value === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
    throw new TypeError("Expected a timestamp with timezone");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid timestamp");
  return date;
}

export function formatDateTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  return dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone }).format(instant(value));
}

export function formatTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
  return dateFormat({ timeStyle: "short", timeZone }).format(instant(value));
}

/** Supplement only: callers also show an exact timestamp. */
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return relativeFormat.format(value, unit);
}
