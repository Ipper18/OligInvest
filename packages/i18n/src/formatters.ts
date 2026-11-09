import type { Decimal } from "decimal.js";

export type DecimalInput = string | Decimal;
export type CurrencyCode = "PLN" | "USD" | "EUR";

function makeFormatters(locale: string, timezone: string) {
  const LOCALE = locale;
  const DEFAULT_TIME_ZONE = timezone;
  const numberFormats = new Map<string, Intl.NumberFormat>();
  const dateFormats = new Map<string, Intl.DateTimeFormat>();
  const relativeFormat = new Intl.RelativeTimeFormat(LOCALE);

  function decimalText(value: DecimalInput): string {
    // Decimal.isDecimal also accepts this stable cross-constructor brand.
    // A type-only import keeps decimal arithmetic out of browser formatters (PERF § 2).
    if (
      typeof value !== "string" &&
      !(
        typeof value === "object" &&
        value !== null &&
        "toStringTag" in value &&
        value.toStringTag === "[object Decimal]"
      )
    ) {
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

  function formatMoney(
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

  function formatPrice(value: DecimalInput, currency: CurrencyCode, digits: number): string {
    return number(value, {
      ...currencyOptions(currency),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatQuantity(value: DecimalInput): string {
    return number(value, { maximumFractionDigits: 4 });
  }

  /** Ratios, e.g. "0.0054" -> "0,54%". */
  function formatPercent(
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

  function formatRatio(value: DecimalInput): string {
    return number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatFxRate(value: DecimalInput): string {
    return number(value, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function formatCompact(value: DecimalInput): string {
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
  function formatDate(value: string): string {
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

  function formatDateTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
    return dateFormat({ dateStyle: "medium", timeStyle: "short", timeZone }).format(instant(value));
  }

  function formatTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE): string {
    return dateFormat({ timeStyle: "short", timeZone }).format(instant(value));
  }

  /** Supplement only: callers also show an exact timestamp. */
  function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return relativeFormat.format(value, unit);
  }

  return {
    formatMoney,
    formatPrice,
    formatQuantity,
    formatPercent,
    formatRatio,
    formatFxRate,
    formatCompact,
    formatDate,
    formatDateTime,
    formatTime,
    formatRelativeTime,
  };
}

const cache = new Map<string, ReturnType<typeof makeFormatters>>();
export function createFormatters({
  locale = "pl-PL",
  timezone = "Europe/Warsaw",
}: {
  locale?: string;
  timezone?: string;
} = {}) {
  const key = `${locale}:${timezone}`;
  let result = cache.get(key);
  if (!result) {
    result = makeFormatters(locale, timezone);
    cache.set(key, result);
  }
  return result;
}
export const {
  formatMoney,
  formatPrice,
  formatQuantity,
  formatPercent,
  formatRatio,
  formatFxRate,
  formatCompact,
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
} = createFormatters();
