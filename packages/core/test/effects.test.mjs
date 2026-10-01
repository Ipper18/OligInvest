import {
  brokerFxRate,
  buildLedger,
  convertMoney,
  fxRate,
  grossValue,
  isCoreError,
  isoDate,
  money,
  negateMoney,
  price,
  priceFxEffect,
  quantity,
  roundMoney,
  sumMoney,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const A = loadTestVectors().A_fifo_fx;
const rounded = (m) => roundMoney(m).amount.toFixed(2);
const d = isoDate;

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

function usdTrade(id, type, tradeDate, qty, px, mid) {
  const gross = grossValue(price(px, "USD"), quantity(qty));
  const midRate = fxRate({
    base: "USD",
    quote: "PLN",
    rate: mid,
    date: tradeDate,
    source: "manual",
  });
  const cash = convertMoney(gross, brokerFxRate(midRate, "0.005", type === "BUY" ? "buy" : "sell"));
  return {
    id,
    accountId: "xtb",
    type,
    tradeDate: d(tradeDate),
    instrumentId: "AAPL",
    quantity: quantity(qty),
    price: price(px, "USD"),
    amount: type === "BUY" ? negateMoney(cash) : cash,
  };
}

const accounts = [
  { id: "xtb", currency: "PLN", accountType: "regular" },
  { id: "xtb2", currency: "PLN", accountType: "regular" },
];
const vectorA = [
  usdTrade("T1", "BUY", "2025-03-03", "10", "240.00", "3.9800"),
  usdTrade("T2", "BUY", "2025-06-02", "5", "200.00", "3.7500"),
  usdTrade("T3", "SELL", "2025-09-02", "12", "230.00", "3.6500"),
];

describe("price and FX effect (obliczenia-finansowe.md § 4.2) — vector A", () => {
  test("realized: effective purchase rate of the consumed lots", () => {
    const [sale] = buildLedger({ accounts, transactions: vectorA }).sales;
    const sum = (field) =>
      sumMoney(
        sale.consumptions.map((c) => c[field]),
        sale.consumptions[0][field].currency,
      );
    const effect = priceFxEffect({
      cost: sum("costEconomic"),
      costInstrument: sum("costInstrument"),
      value: sum("proceedsEconomic"),
      valueInstrument: sum("proceedsInstrument"),
    });
    expect(rounded(effect.priceEffect)).toBe(readDecimalText(A.price_effect_pln));
    expect(rounded(effect.fxEffect)).toBe(readDecimalText(A.fx_effect_pln));
    expect(rounded(effect.pl)).toBe(readDecimalText(A.realized_pl_economic_pln));
    // Identity: both effects add up to the P/L exactly.
    expect(effect.priceEffect.amount.plus(effect.fxEffect.amount).toFixed()).toBe(
      effect.pl.amount.toFixed(),
    );
  });

  test("unrealized: value in both currencies against the remaining cost", () => {
    const effect = priceFxEffect({
      cost: money("2261.25", "PLN"),
      costInstrument: money("600", "USD"),
      value: money("2520", "PLN"),
      valueInstrument: money("630", "USD"),
    });
    // r0 = 3.76875; price effect 30 × 3.76875; FX effect is the rest of 258.75.
    expect(effect.priceEffect.amount.toFixed()).toBe("113.0625");
    expect(effect.fxEffect.amount.toFixed()).toBe("145.6875");
  });

  test("same currency: everything is price effect; zero cost is rejected", () => {
    const effect = priceFxEffect({
      cost: money("100", "PLN"),
      costInstrument: money("100", "PLN"),
      value: money("120", "PLN"),
      valueInstrument: money("120", "PLN"),
    });
    expect(effect.fxEffect.amount.isZero()).toBe(true);
    const zero = {
      cost: money("0", "PLN"),
      costInstrument: money("0", "USD"),
      value: money("1", "PLN"),
      valueInstrument: money("1", "USD"),
    };
    expect(codeOf(() => priceFxEffect(zero))).toBe("division_by_zero");
    const mixed = {
      cost: money("1", "PLN"),
      costInstrument: money("1", "USD"),
      value: money("1", "PLN"),
      valueInstrument: money("1", "EUR"),
    };
    expect(codeOf(() => priceFxEffect(mixed))).toBe("currency_mismatch");
  });
});
