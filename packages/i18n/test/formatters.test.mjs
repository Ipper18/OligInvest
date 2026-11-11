import { Decimal } from "decimal.js";
import { expect, test } from "vitest";
import {
  createFormatters,
  formatCompact,
  formatDate,
  formatDateTime,
  formatFxRate,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRatio,
  formatRelativeTime,
  formatTime,
} from "../dist/index.js";

test("money preserves decimal precision and rounds presentation half up", () => {
  expect(formatMoney("1234.56", "PLN")).toBe("1234,56\u00a0zł");
  expect(formatMoney("12345.67", "PLN")).toBe("12\u00a0345,67\u00a0zł");
  expect(formatMoney("1234.5", "USD")).toBe("1234,50\u00a0USD");
  expect(formatMoney("1", "EUR")).toBe("1,00\u00a0EUR");
  expect(formatMoney("9007199254740993.125", "PLN")).toBe(
    "9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,13\u00a0zł",
  );
  expect(formatMoney(new Decimal("-1.005"), "PLN")).toBe("-1,01\u00a0zł");
  expect(formatMoney("280.45", "PLN", { signed: true })).toBe("+280,45\u00a0zł");
  expect(formatMoney("-0.001", "PLN", { signed: true })).toBe("0,00\u00a0zł");
});

test("all numeric formatters reject numbers and invalid decimals at runtime", () => {
  for (const value of [
    1.23,
    NaN,
    Infinity,
    "",
    " 1",
    "1,23",
    "NaN",
    "Infinity",
    "0xff",
    {},
    null,
    { toString: () => "1.23" },
    { toStringTag: "[object Decimal]", toString: () => "Infinity" },
    new Decimal(Infinity),
  ]) {
    for (const format of [
      formatQuantity,
      formatPercent,
      formatRatio,
      formatFxRate,
      formatCompact,
      (amount) => formatPrice(amount, "PLN", 2),
      (amount) => formatMoney(amount, "PLN"),
    ]) {
      expect(() => format(value)).toThrow();
    }
  }
});

test("presentation accepts Decimal clones without importing their arithmetic into the browser", () => {
  const ClonedDecimal = Decimal.clone({ precision: 34 });
  expect(formatMoney(new ClonedDecimal("9007199254740993.125"), "PLN")).toBe(
    "9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,13\u00a0zł",
  );
  expect(formatQuantity(new Decimal("1.23456"))).toBe("1,2346");
});

test("quantity, quote, percent, ratio, FX and compact precision follow the design system", () => {
  expect(formatQuantity("1.23000")).toBe("1,23");
  expect(formatQuantity("1.23456")).toBe("1,2346");
  expect(formatPrice("0.12345", "PLN", 4)).toBe("0,1235\u00a0zł");
  expect(formatPercent("0.0054")).toBe("0,54%");
  expect(formatPercent("0.0054", { digits: 1, signed: true })).toBe("+0,5%");
  expect(formatRatio("1.235")).toBe("1,24");
  expect(formatFxRate("4.12345")).toBe("4,1235");
  expect(formatCompact("1500000")).toBe("1,5\u00a0mln");
  expect(formatMoney("1500000", "PLN", { compact: true })).toBe("1,5\u00a0mln\u00a0zł");
});

test("session dates are civil dates; instants use explicit user timezone and DST", () => {
  expect(formatDate("2026-09-18")).toBe("18.09.2026");
  expect(formatDateTime("2026-09-18T13:42:00Z")).toBe("18 wrz 2026, 15:42");
  expect(formatDateTime("2026-09-18T13:42:00Z", "America/New_York")).toBe("18 wrz 2026, 09:42");
  expect(formatTime("2026-03-29T01:30:00Z")).toBe("03:30");
  expect(formatRelativeTime(-5, "minute")).toBe("5 minut temu");
  for (const value of ["2026-02-30", "2026-13-01", "2026-09-18T00:00:00Z"])
    expect(() => formatDate(value)).toThrow();
  expect(() => formatDateTime("2026-09-18T13:42:00")).toThrow();
});

test("instants accept ISO 8601 with Z or offset, minutes-only and up to nanosecond fractions", () => {
  expect(formatTime("2026-09-18T13:42Z")).toBe("15:42");
  expect(formatTime("2026-09-18T14:42:00+01:00")).toBe("15:42");
  expect(formatTime("2026-09-18T09:42:00-04:00")).toBe("15:42");
  expect(formatTime("2026-09-18T13:42:00.123Z")).toBe("15:42");
  // PostgreSQL timestamptz JSON (microseconds) and the 9-digit upper bound.
  expect(formatDateTime("2026-09-18T13:42:00.123456+00:00")).toBe("18 wrz 2026, 15:42");
  expect(formatDateTime("2026-09-18T13:42:00.123456789Z")).toBe("18 wrz 2026, 15:42");
  expect(formatDateTime(new Date("2026-09-18T13:42:00Z"))).toBe("18 wrz 2026, 15:42");
});

test("instants without a zone or outside the ISO shape are rejected", () => {
  for (const value of [
    "2026-09-18T13:42:00",
    "2026-09-18T13:42:00.123",
    "2026-09-18 13:42:00Z",
    "2026-09-18 13:42:00+00",
    "2026-09-18T13:42:00+0100",
    "2026-09-18T13:42:00+01",
    "2026-09-18T13:42:00.1234567890Z",
    "2026-09-18",
    "T13:42:00Z",
    "x2026-09-18T13:42:00Z",
    "2026-09-18T13:42:00Zx",
    "2026-09-18T13:42:00Z\n",
    "",
  ])
    expect(() => formatDateTime(value), JSON.stringify(value)).toThrow(TypeError);
  // Shape-valid but impossible instants still fail through Date.
  expect(() => formatDateTime("2026-13-18T13:42:00Z")).toThrow(RangeError);
});

test("timestamp validation is linear: 50 000 × 'T' is rejected quickly (CodeQL js/polynomial-redos)", () => {
  // The former /T.*(?:Z|…)$/ took ~1.6 s on this input; the anchored pattern takes well under 1 ms.
  for (const value of ["T".repeat(50_000), `2026-09-18T${"T".repeat(50_000)}`]) {
    const started = performance.now();
    expect(() => formatDateTime(value)).toThrow(TypeError);
    expect(performance.now() - started).toBeLessThan(50);
  }
});

test("locale and timezone are isolated, with exact English decimal formatting", () => {
  const en = createFormatters({ locale: "en-US", timezone: "America/New_York" });
  const pl = createFormatters({ locale: "pl-PL", timezone: "Europe/Warsaw" });
  expect(en.formatMoney("9007199254740993.125", "USD")).toBe("USD\u00a09,007,199,254,740,993.13");
  expect(en.formatPercent("0.125")).toBe("12.50%");
  expect(en.formatTime("2026-11-09T01:30:00Z")).not.toBe(pl.formatTime("2026-11-09T01:30:00Z"));
  expect(pl.formatMoney("1.005", "PLN")).toBe("1,01\u00a0zł");
  expect(() => en.formatMoney(1.23, "USD")).toThrow();
});
