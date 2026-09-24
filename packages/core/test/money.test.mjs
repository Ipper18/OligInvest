import {
  addMoney,
  CoreError,
  compareMoney,
  currencyCode,
  Decimal,
  divideMoney,
  EUR,
  grossValue,
  isCoreError,
  isNegativeMoney,
  isZeroMoney,
  minorUnits,
  money,
  moneyFromJson,
  moneyToJson,
  multiplyMoney,
  negateMoney,
  PLN,
  price,
  quantity,
  roundHalfUp,
  roundMoney,
  subtractMoney,
  sumMoney,
  toDecimal,
  USD,
  zeroMoney,
} from "@oliginvest/core";
import { describe, expect, test } from "vitest";

const text = (m) => `${m.amount.toFixed()} ${m.currency}`;

function expectCoreError(fn, code) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(isCoreError(caught)).toBe(true);
  expect(caught).toBeInstanceOf(CoreError);
  expect(caught.code).toBe(code);
  return caught;
}

describe("Decimal configuration (obliczenia-finansowe.md § 0.2)", () => {
  test("computes with 34 significant digits and ROUND_HALF_EVEN", () => {
    expect(Decimal.precision).toBe(34);
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
    expect(toDecimal("1").div(3).toString()).toBe("0.3333333333333333333333333333333333");
    expect(toDecimal("2").div(3).toString()).toBe("0.6666666666666666666666666666666667");
    // A tie after the 34th significant digit rounds to even, not up.
    const tie = (digits) =>
      toDecimal(`1.${"0".repeat(32)}${digits}`)
        .times(1)
        .toString();
    expect(tie("25")).toBe(`1.${"0".repeat(32)}2`);
    expect(tie("35")).toBe(`1.${"0".repeat(32)}4`);
  });

  test("never prints exponent notation", () => {
    expect(toDecimal("0.000000000000000000000000000001").toString()).toBe(
      "0.000000000000000000000000000001",
    );
    expect(toDecimal("12345678901234567890123").toString()).toBe("12345678901234567890123");
  });

  test("presentation rounding is ROUND_HALF_UP, away from zero on ties", () => {
    expect(roundHalfUp(toDecimal("0.125"), 2).toFixed(2)).toBe("0.13");
    expect(roundHalfUp(toDecimal("-0.125"), 2).toFixed(2)).toBe("-0.13");
    expect(roundHalfUp(toDecimal("0.135"), 2).toFixed(2)).toBe("0.14");
    // Computation rounding (HALF_EVEN) differs on the same tie.
    expect(toDecimal("0.125").toDecimalPlaces(2).toFixed(2)).toBe("0.12");
  });

  test("accepts only strict decimal text or Decimal instances", () => {
    expect(toDecimal("-12.50").toFixed()).toBe("-12.5");
    expect(toDecimal(toDecimal("3")).toFixed()).toBe("3");
    for (const bad of [0.1, 10, "1e5", "0x10", " 1", "1.", ".5", "+1", "", "Infinity", "NaN"]) {
      expectCoreError(() => toDecimal(bad), "invalid_decimal");
    }
    expectCoreError(() => toDecimal(toDecimal("1").div(0)), "invalid_decimal");
    expectCoreError(() => toDecimal(undefined), "invalid_decimal");
  });
});

describe("CurrencyCode", () => {
  test("validates ISO 4217 codes supported by Intl", () => {
    expect(currencyCode("PLN")).toBe(PLN);
    expect([PLN, USD, EUR]).toEqual(["PLN", "USD", "EUR"]);
    for (const bad of ["pln", "PL", "ZZZ", "", 1]) {
      expectCoreError(() => currencyCode(bad), "invalid_currency");
    }
  });

  test("minor units come from Intl (PLN, USD, EUR: 2; JPY: 0)", () => {
    expect(minorUnits(PLN)).toBe(2);
    expect(minorUnits(USD)).toBe(2);
    expect(minorUnits(EUR)).toBe(2);
    expect(minorUnits(currencyCode("JPY"))).toBe(0);
  });
});

describe("Money", () => {
  test("keeps the currency explicit and the amount unrounded", () => {
    const m = money("1234.56789", "PLN");
    expect(text(m)).toBe("1234.56789 PLN");
    expect(Object.isFrozen(m)).toBe(true);
    expect(text(zeroMoney(USD))).toBe("0 USD");
    expectCoreError(() => money(12.5, "PLN"), "invalid_decimal");
    expectCoreError(() => money("1", "zł"), "invalid_currency");
  });

  test("arithmetic is exact and never mixes currencies", () => {
    const a = money("0.1", PLN);
    const b = money("0.2", PLN);
    expect(text(addMoney(a, b))).toBe("0.3 PLN");
    expect(text(subtractMoney(a, b))).toBe("-0.1 PLN");
    expect(text(negateMoney(a))).toBe("-0.1 PLN");
    expect(text(multiplyMoney(money("2400", USD), "3.9999"))).toBe("9599.76 USD");
    expect(text(divideMoney(money("13368.51", PLN), "15"))).toBe("891.234 PLN");
    expect(text(sumMoney([a, b, money("0.7", PLN)], PLN))).toBe("1 PLN");
    expect(text(sumMoney([], EUR))).toBe("0 EUR");
    const error = expectCoreError(() => addMoney(a, money("1", USD)), "currency_mismatch");
    expect(error.details).toEqual({ expected: "PLN", actual: "USD" });
    expectCoreError(() => sumMoney([a], USD), "currency_mismatch");
    expectCoreError(() => divideMoney(a, "0"), "division_by_zero");
  });

  test("comparisons and predicates", () => {
    expect(compareMoney(money("1.10", PLN), money("1.1", PLN))).toBe(0);
    expect(compareMoney(money("1", PLN), money("2", PLN))).toBe(-1);
    expect(compareMoney(money("3", PLN), money("2", PLN))).toBe(1);
    expectCoreError(() => compareMoney(money("1", PLN), money("1", EUR)), "currency_mismatch");
    expect(isZeroMoney(money("0.00", PLN))).toBe(true);
    expect(isZeroMoney(money("-0", PLN))).toBe(true);
    expect(isNegativeMoney(money("-0.01", PLN))).toBe(true);
    expect(isNegativeMoney(money("-0", PLN))).toBe(false);
  });

  test("rounds to the currency unit with ROUND_HALF_UP only on request", () => {
    expect(text(roundMoney(money("77.809", PLN)))).toBe("77.81 PLN");
    expect(text(roundMoney(money("17.5275", PLN)))).toBe("17.53 PLN");
    expect(text(roundMoney(money("-0.005", PLN)))).toBe("-0.01 PLN");
    expect(text(roundMoney(money("100.5", "JPY")))).toBe("101 JPY");
  });

  test("JSON uses decimal strings with an explicit currency (ADR-014)", () => {
    expect(moneyToJson(money("1234.5", PLN))).toEqual({ amount: "1234.5", currency: "PLN" });
    expect(moneyToJson(money("1234.5", PLN), { fractionDigits: 2 })).toEqual({
      amount: "1234.50",
      currency: "PLN",
    });
    expect(moneyToJson(money("0.125", PLN), { fractionDigits: 2 }).amount).toBe("0.13");
    expect(text(moneyFromJson({ amount: "-10.00", currency: "USD" }))).toBe("-10 USD");
    expectCoreError(() => moneyFromJson({ amount: 10, currency: "USD" }), "invalid_decimal");
    expectCoreError(() => moneyFromJson(null), "invalid_decimal");
  });
});

describe("Quantity and Price", () => {
  test("quantity allows fractions and rejects negatives", () => {
    expect(quantity("0.3069").toFixed()).toBe("0.3069");
    expect(quantity("0").isZero()).toBe(true);
    expectCoreError(() => quantity("-1"), "invalid_quantity");
    expectCoreError(() => quantity(1), "invalid_decimal");
  });

  test("price carries its quote currency and multiplies into money", () => {
    const p = price("240.00", USD);
    expect(p.currency).toBe("USD");
    expect(Object.isFrozen(p)).toBe(true);
    expect(text(grossValue(p, quantity("10")))).toBe("2400 USD");
    expectCoreError(() => price("-1", USD), "invalid_price");
  });
});
