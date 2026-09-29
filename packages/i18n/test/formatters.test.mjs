import { Decimal } from "decimal.js";
import { expect, test } from "vitest";
import {
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
