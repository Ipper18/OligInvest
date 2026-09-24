import {
  brokerFxRate,
  convertMoney,
  createFxRateTable,
  fxConversionCost,
  fxRate,
  invertFxRate,
  isCoreError,
  money,
  roundMoney,
  toDecimal,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const A = loadTestVectors().A_fifo_fx;
const text = (m) => `${m.amount.toFixed()} ${m.currency}`;
const mid = (rate, date) => fxRate({ base: "USD", quote: "PLN", rate, date, source: "manual" });

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : "not-core-error";
  }
  return "no-error";
}

describe("FxRate", () => {
  test("rate is units of quote per one base and is validated", () => {
    const r = mid("3.9800", "2025-03-03");
    expect(r).toMatchObject({ base: "USD", quote: "PLN", date: "2025-03-03", source: "manual" });
    expect(r.rate.toFixed()).toBe("3.98");
    expect(Object.isFrozen(r)).toBe(true);
    expect(codeOf(() => mid("0", "2025-03-03"))).toBe("invalid_fx_rate");
    expect(codeOf(() => mid("-1", "2025-03-03"))).toBe("invalid_fx_rate");
    expect(codeOf(() => mid("1", "2025-02-30"))).toBe("invalid_date");
    expect(codeOf(() => fxRate({ base: "PLN", quote: "PLN", rate: "1", date: "2025-01-02" }))).toBe(
      "invalid_fx_rate",
    );
    expect(codeOf(() => fxRate({ base: "USD", quote: "PLN", rate: "1", date: "2025-01-02" }))).toBe(
      "invalid_fx_rate",
    );
  });

  test("converts base to quote exactly and refuses the wrong direction", () => {
    const r = mid("3.9999", "2025-03-03");
    expect(text(convertMoney(money("2400", "USD"), r))).toBe("9599.76 PLN");
    expect(codeOf(() => convertMoney(money("1", "PLN"), r))).toBe("currency_mismatch");
    const inverse = invertFxRate(mid("4", "2025-03-03"));
    expect(inverse).toMatchObject({ base: "PLN", quote: "USD", source: "manual" });
    expect(text(convertMoney(money("10", "PLN"), inverse))).toBe("2.5 USD");
  });
});

describe("broker FX margin (obliczenia-finansowe.md § 2.1) — vector A", () => {
  test("broker rate is mid·(1 + m) when buying currency and mid·(1 − m) when selling", () => {
    expect(brokerFxRate(mid("3.9800", "2025-03-03"), "0.005", "buy").rate.toFixed(6)).toBe(
      readDecimalText(A.lots[0].rate_ask),
    );
    expect(brokerFxRate(mid("3.7500", "2025-06-02"), "0.005", "buy").rate.toFixed(6)).toBe(
      readDecimalText(A.lots[1].rate_ask),
    );
    const bid = brokerFxRate(mid("3.6500", "2025-09-02"), "0.005", "sell");
    expect(bid.rate.toFixed(6)).toBe(readDecimalText(A.sell.rate_bid));
    expect(bid).toMatchObject({ source: "broker", date: "2025-09-02" });
    expect(codeOf(() => brokerFxRate(mid("3.65", "2025-09-02"), "1", "sell"))).toBe(
      "invalid_fx_rate",
    );
    expect(codeOf(() => brokerFxRate(mid("3.65", "2025-09-02"), "-0.1", "buy"))).toBe(
      "invalid_fx_rate",
    );
  });

  test("conversion cost is q·p·mid·m in the quote currency", () => {
    const t1 = fxConversionCost(money("2400", "USD"), mid("3.9800", "2025-03-03"), "0.005");
    const t2 = fxConversionCost(money("1000", "USD"), mid("3.7500", "2025-06-02"), "0.005");
    const sell = fxConversionCost(money("2760", "USD"), mid("3.6500", "2025-09-02"), "0.005");
    expect(t1.amount.toFixed(6)).toBe(readDecimalText(A.lots[0].fx_fee_pln));
    expect(t2.amount.toFixed(6)).toBe(readDecimalText(A.lots[1].fx_fee_pln));
    expect(roundMoney(sell).amount.toFixed(2)).toBe(readDecimalText(A.sell.fx_fee_pln));
    expect(sell.currency).toBe("PLN");
  });
});

describe("FxRateTable", () => {
  const table = createFxRateTable([
    mid("3.9750", "2025-03-03"),
    mid("3.9500", "2025-02-28"),
    fxRate({ base: "EUR", quote: "PLN", rate: "4.2000", date: "2025-03-03", source: "nbp" }),
    fxRate({ base: "EUR", quote: "PLN", rate: "4.1900", date: "2025-02-27", source: "nbp" }),
  ]);

  test("onOrBefore returns the last published rate up to the date (carry-forward)", () => {
    expect(table.onOrBefore("USD", "PLN", "2025-03-03").rate.toFixed(4)).toBe("3.9750");
    expect(table.onOrBefore("USD", "PLN", "2025-03-02").rate.toFixed(4)).toBe("3.9500");
    expect(table.onOrBefore("USD", "PLN", "2025-02-27")).toBeUndefined();
  });

  test("before returns the rate from the last day strictly before the date (NBP D-1)", () => {
    expect(table.before("USD", "PLN", "2025-03-04").rate.toFixed(4)).toBe("3.9750");
    expect(table.before("USD", "PLN", "2025-03-03").rate.toFixed(4)).toBe("3.9500");
    expect(table.before("USD", "PLN", "2025-02-28")).toBeUndefined();
  });

  test("resolves identity, inverse and cross rates through PLN", () => {
    const identity = table.onOrBefore("PLN", "PLN", "2025-03-03");
    expect(identity).toMatchObject({ base: "PLN", quote: "PLN", source: "derived" });
    expect(identity.rate.toFixed()).toBe("1");
    const inverse = table.onOrBefore("PLN", "USD", "2025-03-03");
    expect(inverse.rate.toFixed()).toBe(invertFxRate(mid("3.9750", "2025-03-03")).rate.toFixed());
    const cross = table.onOrBefore("EUR", "USD", "2025-03-03");
    expect(cross).toMatchObject({ base: "EUR", quote: "USD", source: "derived" });
    expect(cross.rate.toFixed()).toBe(toDecimal("4.2").div("3.975").toFixed());
    const older = table.onOrBefore("EUR", "USD", "2025-03-01");
    expect(older.date).toBe("2025-02-27");
    const sameSource = createFxRateTable([
      fxRate({ base: "EUR", quote: "PLN", rate: "4.2", date: "2025-03-03", source: "nbp" }),
      fxRate({ base: "USD", quote: "PLN", rate: "4", date: "2025-03-03", source: "nbp" }),
    ]);
    expect(sameSource.onOrBefore("EUR", "USD", "2025-03-03").source).toBe("nbp");
    expect(table.onOrBefore("GBP", "USD", "2025-03-03")).toBeUndefined();
    expect(table.before("EUR", "USD", "2025-02-28")).toBeUndefined();
  });

  test("rejects duplicate rates for the same pair and day", () => {
    expect(codeOf(() => createFxRateTable([mid("1", "2025-01-02"), mid("2", "2025-01-02")]))).toBe(
      "duplicate_fx_rate",
    );
  });
});
