import {
  formatFxRate,
  formatMoney,
  formatPrice,
  formatQuantity,
  formatRatio,
  fxRate,
  isCoreError,
  money,
  price,
  quantity,
  toDecimal,
} from "@oliginvest/core";
import { describe, expect, test } from "vitest";

// Intl pl-PL separators: U+00A0 groups thousands (system-projektowy.md § 5).
const nbsp = " ";

describe("pl-PL formatting (system-projektowy.md § 5)", () => {
  test("money: two decimals, CLDR grouping, ISO code for foreign currencies", () => {
    expect(formatMoney(money("1234.56", "PLN"))).toBe(`1234,56${nbsp}zł`);
    expect(formatMoney(money("12345.67", "PLN"))).toBe(`12${nbsp}345,67${nbsp}zł`);
    expect(formatMoney(money("1234.5", "USD"))).toBe(`1234,50${nbsp}USD`);
    expect(formatMoney(money("280.45", "PLN"), { signDisplay: "exceptZero" })).toBe(
      `+280,45${nbsp}zł`,
    );
    expect(formatMoney(money("-280.45", "PLN"), { signDisplay: "exceptZero" })).toBe(
      `-280,45${nbsp}zł`,
    );
  });

  test("money: rounds ROUND_HALF_UP from exact decimals, beyond float precision", () => {
    expect(formatMoney(money("0.125", "PLN"))).toBe(`0,13${nbsp}zł`);
    expect(formatMoney(money("-0.125", "PLN"))).toBe(`-0,13${nbsp}zł`);
    expect(formatMoney(money("12345678901234567.125", "PLN"))).toBe(
      `12${nbsp}345${nbsp}678${nbsp}901${nbsp}234${nbsp}567,13${nbsp}zł`,
    );
  });

  test("price uses the quote precision; quantity up to 4 places without trailing zeros", () => {
    expect(formatPrice(price("240", "USD"))).toBe(`240,00${nbsp}USD`);
    expect(formatPrice(price("0.12345", "PLN"), { fractionDigits: 4 })).toBe(`0,1235${nbsp}zł`);
    expect(formatQuantity(quantity("10"))).toBe("10");
    expect(formatQuantity(quantity("0.30695"))).toBe("0,307");
    expect(formatQuantity(quantity("12345.5"))).toBe(`12${nbsp}345,5`);
  });

  test("FX rates show 4 places like NBP table A", () => {
    const r = fxRate({
      base: "USD",
      quote: "PLN",
      rate: "3.98",
      date: "2025-03-03",
      source: "nbp",
    });
    expect(formatFxRate(r)).toBe("3,9800");
    expect(formatFxRate(toDecimal("3.631745"))).toBe("3,6317");
    expect(formatFxRate(toDecimal("3.63175"))).toBe("3,6318");
  });

  test("ratios render as percent with 2 places; tiny non-zero values as a bound", () => {
    expect(formatRatio(toDecimal("280.45").div("52340.10"))).toBe("0,54%");
    expect(formatRatio(0.0053582)).toBe("0,54%");
    expect(formatRatio(-0.1234, { signDisplay: "exceptZero" })).toBe("-12,34%");
    expect(formatRatio(0)).toBe("0,00%");
    expect(formatRatio(0.00004)).toBe("< 0,01%");
    expect(formatRatio(toDecimal("-0.00004"))).toBe("> -0,01%");
    expect(formatRatio(0.5, { fractionDigits: 1 })).toBe("50,0%");
  });

  test("rejects non-finite ratios and invalid precision", () => {
    const codeOf = (fn) => {
      try {
        fn();
      } catch (error) {
        return isCoreError(error) ? error.code : "not-core-error";
      }
      return "no-error";
    };
    expect(codeOf(() => formatRatio(Number.NaN))).toBe("invalid_decimal");
    expect(codeOf(() => formatPrice(price("1", "PLN"), { fractionDigits: -1 }))).toBe(
      "invalid_format",
    );
  });
});
