import {
  buildLedger,
  createFxRateTable,
  fxRate,
  grossValue,
  isNbpBusinessDay,
  isoDate,
  isPolishPublicHoliday,
  money,
  price,
  priceFxEffect,
  quantity,
  roundMoney,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

// Vector A on an account kept in the instrument currency (BL-306b, Z-29, § 4.2.1).
const V = loadTestVectors().A_fifo_fx.instrument_currency_account;
const d = isoDate;
const usd = (amount) => money(amount, "USD");
const accounts = [
  { id: "usd", currency: "USD", accountType: "regular" },
  { id: "pln", currency: "PLN", accountType: "regular" },
  { id: "ike-usd", currency: "USD", accountType: "ike" },
];
const nbp = createFxRateTable(
  V.nbp_rates.map((r) =>
    fxRate({ base: "USD", quote: "PLN", rate: r.rate, date: r.date, source: "nbp" }),
  ),
);
const [L1, L2] = V.lots;
const buy = (lot, accountId = "usd") => ({
  id: lot.lot,
  accountId,
  type: "BUY",
  tradeDate: d(lot.trade_date),
  settleDate: d(lot.settle_date),
  instrumentId: "AAPL",
  quantity: quantity(lot.qty),
  price: price(lot.price_usd, "USD"),
  fee: usd(lot.fee_usd),
  amount: usd(`-${readDecimalText(lot.cost_usd)}`),
});
const sell = {
  id: V.sell.lot,
  accountId: "usd",
  type: "SELL",
  tradeDate: d(V.sell.trade_date),
  settleDate: d(V.sell.settle_date),
  instrumentId: "AAPL",
  quantity: quantity(V.sell.qty),
  price: price(V.sell.price_usd, "USD"),
  amount: usd("2760.00"),
};
const ledgerOf = (transactions, extra = {}) =>
  buildLedger({ accounts, transactions, taxRates: nbp, ...extra });
const text = (m) => m.amount.toFixed();
const rounded = (m) => roundMoney(m).amount.toFixed(2);

describe("PLN cost on an instrument-currency account (BL-306b) — vector A′", () => {
  test("weekend: settled on Monday → NBP of Friday, not of the settlement day", () => {
    const [lot] = ledgerOf([buy(L1)]).lots;
    expect(lot.cost).toEqual(usd("2400.00"));
    expect(lot.costPlnRate).toMatchObject({ date: L1.nbp_rate_date, source: "nbp" });
    expect(lot.costPln).toEqual(money(readDecimalText(L1.cost_pln), "PLN"));
    expect(lot.costPlnRemaining).toEqual(lot.costPln);
    expect(lot.costPlnRateExpected).toBe(L1.nbp_rate_date);
    expect(lot.costPlnRateStale).toBe(false);
  });

  test("holiday: the day before settlement (11.11) has no table → NBP of 10.11", () => {
    const [lot] = ledgerOf([buy(L2)]).lots;
    expect(lot.cost).toEqual(usd(readDecimalText(L2.cost_usd)));
    expect(lot.costPlnRate.date).toBe(L2.nbp_rate_date);
    expect(text(lot.costPln)).toBe(readDecimalText(L2.cost_pln).replace(/0+$/, ""));
    // 11.11 is not an NBP business day: the table of 10.11 is the expected one, not stale.
    expect(lot.costPlnRateExpected).toBe(L2.nbp_rate_date);
    expect(lot.costPlnRateStale).toBe(false);
  });

  test("gap in NBP data: the older table is used and marked stale with both dates", () => {
    // Settled Thursday 2025-11-13: the table of Wednesday 2025-11-12 is expected; drop it.
    const gapRates = createFxRateTable(
      V.nbp_rates
        .filter((r) => r.date !== "2025-11-12")
        .map((r) =>
          fxRate({ base: "USD", quote: "PLN", rate: r.rate, date: r.date, source: "nbp" }),
        ),
    );
    const late = { ...buy(L2), settleDate: d("2025-11-13") };
    const [lot] = buildLedger({ accounts, transactions: [late], taxRates: gapRates }).lots;
    expect(lot.costPlnRate.date).toBe("2025-11-10");
    expect(lot.costPlnRateExpected).toBe("2025-11-12");
    expect(lot.costPlnRateStale).toBe(true);
    // The value stays (as in the tax view), the age of the data is not hidden.
    expect(text(lot.costPln)).toBe("3703.7");
  });

  test("NBP business days: weekends and Polish public holidays (movable and fixed)", () => {
    for (const day of [
      "2025-01-01",
      "2025-01-06",
      "2025-04-21",
      "2025-05-01",
      "2025-05-03",
      "2025-06-19",
      "2025-08-15",
      "2025-11-01",
      "2025-11-11",
      "2025-12-24",
      "2025-12-25",
      "2025-12-26",
      "2024-04-01",
      "2024-05-30",
      "2026-04-06",
      "2026-06-04",
    ])
      expect(isPolishPublicHoliday(day), day).toBe(true);
    // 24.12 only since 2025, 6.01 only since 2011; Good Friday and 31.12 are business days.
    for (const day of ["2024-12-24", "2010-01-06", "2025-04-18", "2025-12-31", "2025-11-10"])
      expect(isPolishPublicHoliday(day), day).toBe(false);
    expect(isNbpBusinessDay("2025-11-10")).toBe(true);
    expect(isNbpBusinessDay("2025-11-11")).toBe(false);
    expect(isNbpBusinessDay("2025-03-08")).toBe(false);
  });

  test("FIFO sale keeps the PLN cost of the remainder proportional", () => {
    const ledger = ledgerOf([buy(L1), buy(L2), sell]);
    const [position] = ledger.positions;
    expect(position.quantity.toFixed()).toBe(V.remaining.qty);
    expect(position.cost).toEqual(usd(readDecimalText(V.remaining.cost_usd)));
    expect(rounded(position.costPln)).toBe(readDecimalText(V.remaining.cost_pln));
    const t1 = ledger.lots.find((l) => l.key === "T1");
    expect(t1.costPlnRemaining.amount.isZero()).toBe(true);
    expect(t1.costPln.amount.toFixed()).toBe("9240");
  });

  test("price and FX effect with r0 = PLN cost / K_i; identity holds", () => {
    const [position] = ledgerOf([buy(L1), buy(L2), sell]).positions;
    const value = grossValue(price(V.valuation.price_usd, "USD"), position.quantity);
    const rate = nbp.onOrBefore("USD", "PLN", V.valuation.date);
    const effect = priceFxEffect({
      cost: position.costPln,
      costInstrument: position.costInstrument,
      value: money(value.amount.times(rate.rate), "PLN"),
      valueInstrument: value,
    });
    expect(position.costPln.amount.div(position.costInstrument.amount).toFixed()).toBe(
      V.valuation.r0,
    );
    expect(rounded(effect.pl)).toBe(readDecimalText(V.valuation.pl_pln));
    expect(rounded(effect.priceEffect)).toBe(readDecimalText(V.valuation.price_effect_pln));
    expect(rounded(effect.fxEffect)).toBe(readDecimalText(V.valuation.fx_effect_pln));
    expect(effect.priceEffect.amount.plus(effect.fxEffect.amount).eq(effect.pl.amount)).toBe(true);
    // Never the "false zero" of today's rate: the FX effect is the move since the cost day.
    expect(effect.fxEffect.amount.isZero()).toBe(false);
  });

  test("missing NBP rate → explicit null, never 0 or today's rate", () => {
    const early = { ...buy(L1), settleDate: d("2025-03-06") };
    const ledger = ledgerOf([early]);
    const [lot] = ledger.lots;
    expect(lot.cost).toEqual(usd("2400.00"));
    expect(lot.costPln).toBeNull();
    expect(lot.costPlnRemaining).toBeNull();
    expect(lot.costPlnRate).toBeNull();
    expect(lot.costPlnRateExpected).toBeNull();
    expect(lot.costPlnRateStale).toBe(false);
    expect(ledger.positions[0].costPln).toBeNull();
    const noRates = buildLedger({ accounts, transactions: [buy(L1)] });
    expect(noRates.positions[0].costPln).toBeNull();
    // One lot without the PLN cost makes the position's PLN cost unknown.
    const mixed = ledgerOf([early, buy(L2)]);
    expect(mixed.positions[0].costPln).toBeNull();
  });

  test("missing settlement date → no cost day → null (as in the tax view)", () => {
    const { settleDate: _, ...noSettle } = buy(L1);
    expect(ledgerOf([noSettle]).positions[0].costPln).toBeNull();
    const byTrade = ledgerOf([noSettle], {
      taxSettings: { dateBasis: "trade", includeFxFee: false },
    });
    expect(byTrade.lots[0].costPlnRate.date).toBe(V.trade_date_basis.T1_nbp_rate_date);
    expect(text(byTrade.lots[0].costPln)).toBe("9360");
  });

  test("tax date basis 'trade' uses the trade date, like the tax view", () => {
    const ledger = ledgerOf([buy(L1)], {
      taxSettings: { dateBasis: "trade", includeFxFee: false },
    });
    expect(ledger.lots[0].costPlnRate.date).toBe(V.trade_date_basis.T1_nbp_rate_date);
    expect(text(ledger.lots[0].costPln)).toBe(
      readDecimalText(V.trade_date_basis.T1_cost_pln).replace(/\.?0+$/, ""),
    );
    // Same rate and amount as the tax-view cost on a taxable account without FX margin.
    expect(ledger.lots[0].taxCost).toEqual(ledger.lots[0].costPln);
  });

  test("IKE/IKZE in USD: no tax view, but the PLN cost is known", () => {
    const [lot] = ledgerOf([buy(L1, "ike-usd")]).lots;
    expect(lot.taxCost).toBeNull();
    expect(lot.costPln).toEqual(money("9240", "PLN"));
  });

  test("PLN account: the PLN cost is the economic cost, no rate", () => {
    const plnBuy = {
      id: "P1",
      accountId: "pln",
      type: "BUY",
      tradeDate: d("2025-03-07"),
      settleDate: d("2025-03-10"),
      instrumentId: "AAPL",
      quantity: quantity("1"),
      price: price("240.00", "USD"),
      amount: money("-925.00", "PLN"),
    };
    const [lot] = ledgerOf([plnBuy]).lots;
    expect(lot.costPln).toEqual(money("925.00", "PLN"));
    expect(lot.costPlnRate).toBeNull();
  });

  test("unknown cost (transfer without declared cost) → null; declared cost → NBP before acquisition", () => {
    const transfer = (extra) => ({
      id: "X1",
      accountId: "usd",
      type: "SECURITY_TRANSFER_IN",
      tradeDate: d("2025-11-12"),
      instrumentId: "AAPL",
      quantity: quantity("1"),
      ...extra,
    });
    expect(ledgerOf([transfer({})]).positions[0].costPln).toBeNull();
    const declared = ledgerOf([
      transfer({ acquisitionCost: usd("100"), acquiredOn: d("2025-03-10") }),
    ]);
    expect(declared.lots[0].costPlnRate.date).toBe("2025-03-07");
    expect(text(declared.lots[0].costPln)).toBe("385");
  });

  test("transfers: to PLN the cost becomes the PLN cost; from PLN the original PLN cost moves on", () => {
    const out = (from, to, id) => [
      {
        id: `${id}-out`,
        accountId: from,
        type: "SECURITY_TRANSFER_OUT",
        tradeDate: d("2025-11-12"),
        instrumentId: "AAPL",
        quantity: quantity("10"),
        sequence: 1,
        relatedTransactionId: `${id}-in`,
      },
      {
        id: `${id}-in`,
        accountId: to,
        type: "SECURITY_TRANSFER_IN",
        tradeDate: d("2025-11-12"),
        instrumentId: "AAPL",
        quantity: quantity("10"),
        sequence: 2,
        relatedTransactionId: `${id}-out`,
      },
    ];
    const toPln = ledgerOf([buy(L1), ...out("usd", "pln", "M")]);
    const [moved] = toPln.positions;
    // 2400 USD at the NBP rate of the transfer day (3.6500) is now the PLN cost.
    expect(moved.cost).toEqual(money("8760", "PLN"));
    expect(moved.costPln).toEqual(moved.cost);
    const plnLot = {
      id: "P1",
      accountId: "pln",
      type: "BUY",
      tradeDate: d("2025-03-07"),
      settleDate: d("2025-03-10"),
      instrumentId: "AAPL",
      quantity: quantity("10"),
      price: price("240.00", "USD"),
      amount: money("-9300.00", "PLN"),
    };
    const fromPln = ledgerOf([plnLot, ...out("pln", "usd", "N")]);
    const [kept] = fromPln.positions;
    expect(kept.cost.currency).toBe("USD");
    expect(kept.costPln).toEqual(money("9300.00", "PLN"));
  });
});
