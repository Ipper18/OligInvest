import {
  brokerFxRate,
  buildLedger,
  convertMoney,
  createFxRateTable,
  currencyExposure,
  fxRate,
  grossValue,
  isCoreError,
  isoDate,
  money,
  negateMoney,
  price,
  priceFxEffect,
  priceFxEffectsByCurrency,
  quantity,
  roundMoney,
  sumPriceFxEffects,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const A = loadTestVectors().A_fifo_fx;
const d = isoDate;

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

// Vector A (§ 3.7) after the sale: 3 shares from T2 at a known PLN and USD cost.
const ledger = buildLedger({
  accounts: [{ id: "xtb", currency: "PLN", accountType: "regular" }],
  transactions: [
    {
      id: "D",
      accountId: "xtb",
      type: "DEPOSIT",
      tradeDate: d("2025-03-01"),
      amount: money("10000", "PLN"),
    },
    usdTrade("T1", "BUY", "2025-03-03", "10", "240.00", "3.9800"),
    usdTrade("T2", "BUY", "2025-06-02", "5", "200.00", "3.7500"),
    usdTrade("T3", "SELL", "2025-09-02", "12", "230.00", "3.6500"),
  ],
});
// Illustrative valuation (not part of vector A): close 210 USD, NBP mid 4.0000 two days earlier.
const rates = createFxRateTable([
  fxRate({ base: "USD", quote: "PLN", rate: "4.0000", date: "2025-09-30", source: "nbp" }),
]);
const [position] = ledger.positions;
const market = grossValue(price("210", "USD"), position.quantity);

describe("currency exposure (obliczenia-finansowe.md § 4.2.1) on vector A", () => {
  test("the remaining lot matches vector A", () => {
    expect(position.quantity.toFixed()).toBe(readDecimalText(A.remaining_after_sale.qty));
    expect(roundMoney(position.cost).amount.toFixed(2)).toBe(
      readDecimalText(A.remaining_after_sale.cost_pln),
    );
    expect(position.costInstrument.amount.toFixed()).toBe("600");
  });

  test("slices by holding currency, NBP rate on or before the day, weights add up to 1", () => {
    const exposure = currencyExposure({
      items: [
        { kind: "security", currency: "USD", value: market },
        ...ledger.cash.map((c) => ({
          kind: "cash",
          currency: c.balance.currency,
          value: c.balance,
        })),
        { kind: "cash", currency: "USD", value: money("100", "USD") },
        { kind: "cash", currency: "EUR", value: money("0", "EUR") },
      ],
      fxRates: rates,
      date: "2025-10-02",
    });
    expect(exposure.isComplete).toBe(true);
    // Zero cash is no exposure; the reporting currency comes first.
    expect(exposure.slices.map((s) => s.currency)).toEqual(["PLN", "USD"]);
    const [pln, usd] = exposure.slices;
    // 10 000 − 9 599.76 − 3 768.75 + 10 023.63 (vector A cash flows, unrounded).
    expect(roundMoney(pln.value).amount.toFixed(2)).toBe("6655.12");
    expect(pln.rate).toBeNull();
    expect(usd.valueInCurrency.amount.toFixed()).toBe("730");
    expect(usd.securities.amount.toFixed()).toBe("2520");
    expect(usd.cash.amount.toFixed()).toBe("400");
    expect(usd.value.amount.toFixed()).toBe("2920");
    expect(usd.rate.date).toBe("2025-09-30");
    expect(usd.rate.source).toBe("nbp");
    expect(exposure.total.amount.toFixed()).toBe(pln.value.amount.plus(2920).toFixed());
    expect(pln.weight.plus(usd.weight).toFixed()).toBe("1");
    expect(usd.weight.toDecimalPlaces(6).toFixed()).toBe("0.304957");
  });

  test("a missing price or rate leaves the slice and the total null, never 0", () => {
    const noPrice = currencyExposure({
      items: [
        { kind: "security", currency: "USD", value: null },
        { kind: "cash", currency: "USD", value: money("100", "USD") },
        { kind: "cash", currency: "PLN", value: money("50", "PLN") },
      ],
      fxRates: rates,
      date: "2025-10-02",
    });
    expect(noPrice.isComplete).toBe(false);
    expect(noPrice.total).toBeNull();
    const usd = noPrice.slices[1];
    expect(usd.status).toBe("missing_price");
    expect([usd.valueInCurrency, usd.value, usd.securities, usd.cash, usd.weight]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(noPrice.slices[0].value.amount.toFixed()).toBe("50");
    expect(noPrice.slices[0].weight).toBeNull();
    const noRate = currencyExposure({
      items: [{ kind: "security", currency: "EUR", value: money("10", "EUR") }],
      fxRates: rates,
      date: "2025-09-29",
    });
    expect(noRate.slices[0].status).toBe("missing_fx");
    expect(noRate.slices[0].valueInCurrency.amount.toFixed()).toBe("10");
    expect(noRate.slices[0].value).toBeNull();
    // Before the first table the USD rate is unknown as well.
    const early = currencyExposure({
      items: [{ kind: "cash", currency: "USD", value: money("1", "USD") }],
      fxRates: rates,
      date: "2025-09-29",
    });
    expect(early.slices[0].status).toBe("missing_fx");
    const empty = currencyExposure({ items: [], fxRates: rates, date: "2025-10-02" });
    expect([empty.slices, empty.total?.amount.toFixed(), empty.isComplete]).toEqual([
      [],
      "0",
      true,
    ]);
    let code;
    try {
      currencyExposure({
        items: [{ kind: "cash", currency: "USD", value: money("1", "EUR") }],
        fxRates: rates,
        date: "2025-10-02",
      });
    } catch (error) {
      code = isCoreError(error) ? error.code : String(error);
    }
    expect(code).toBe("currency_mismatch");
  });

  test("price and FX effect totals per currency keep the § 4.2 identity", () => {
    const value = convertMoney(market, rates.onOrBefore("USD", "PLN", "2025-10-02"));
    const effect = priceFxEffect({
      cost: position.cost,
      costInstrument: position.costInstrument,
      value,
      valueInstrument: market,
    });
    const other = priceFxEffect({
      cost: money("1000", "PLN"),
      costInstrument: money("250", "USD"),
      value: money("900", "PLN"),
      valueInstrument: money("240", "USD"),
    });
    const byCurrency = priceFxEffectsByCurrency([
      { currency: "USD", effect },
      { currency: "USD", effect: other },
    ]);
    const usd = byCurrency.get("USD");
    expect([...byCurrency.keys()]).toEqual(["USD"]);
    // Vector A remainder: (630 − 600) · 3.76875 and the rest of 2 520 − 2 261.25.
    expect(effect.priceEffect.amount.toFixed()).toBe("113.0625");
    expect(effect.fxEffect.amount.toFixed()).toBe("145.6875");
    expect(usd.pl.amount.toFixed()).toBe("158.75");
    expect(usd.priceEffect.amount.toFixed()).toBe("73.0625");
    expect(usd.priceEffect.amount.plus(usd.fxEffect.amount).toFixed()).toBe(
      usd.pl.amount.toFixed(),
    );
    expect(sumPriceFxEffects([], "PLN").pl.amount.isZero()).toBe(true);
  });
});
