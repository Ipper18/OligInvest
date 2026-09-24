import {
  brokerFxRate,
  buildLedger,
  convertMoney,
  createFxRateTable,
  fxConversionCost,
  fxRate,
  grossValue,
  isCoreError,
  isoDate,
  money,
  negateMoney,
  price,
  quantity,
  sortTransactions,
  toDecimal,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const A = loadTestVectors().A_fifo_fx;
const fixed = (m, places = 2) => m.amount.toFixed(places);
const vec = (value) => readDecimalText(value);

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

const nbp = (currency, rate, date) =>
  fxRate({ base: currency, quote: "PLN", rate, date, source: "nbp" });
const midUsd = (rate, date) => fxRate({ base: "USD", quote: "PLN", rate, date, source: "manual" });

/**
 * Operation on a PLN account in XTB for a USD instrument (obliczenia-finansowe.md § 3.7):
 * cash = q·p at the broker rate, FX margin 0.5 % reported as fxFee, commission 0.
 */
function usdTrade({ id, type, tradeDate, settleDate, qty, px, mid, sequence = 0 }) {
  const gross = grossValue(price(px, "USD"), quantity(qty));
  const midRate = midUsd(mid, tradeDate);
  const cash = convertMoney(gross, brokerFxRate(midRate, "0.005", type === "BUY" ? "buy" : "sell"));
  return {
    id,
    accountId: "xtb",
    type,
    tradeDate: isoDate(tradeDate),
    settleDate: settleDate === undefined ? undefined : isoDate(settleDate),
    sequence,
    instrumentId: "AAPL",
    quantity: quantity(qty),
    price: price(px, "USD"),
    amount: type === "BUY" ? negateMoney(cash) : cash,
    fee: money("0", "PLN"),
    fxFee: fxConversionCost(gross, midRate, "0.005"),
  };
}

const accounts = [
  { id: "xtb", currency: "PLN", accountType: "regular" },
  { id: "ike", currency: "PLN", accountType: "ike" },
  { id: "mbank", currency: "PLN", accountType: "regular" },
];

const vectorA = [
  usdTrade({
    id: "T1",
    type: "BUY",
    tradeDate: "2025-03-03",
    settleDate: "2025-03-04",
    qty: "10",
    px: "240.00",
    mid: "3.9800",
  }),
  usdTrade({
    id: "T2",
    type: "BUY",
    tradeDate: "2025-06-02",
    settleDate: "2025-06-03",
    qty: "5",
    px: "200.00",
    mid: "3.7500",
  }),
  usdTrade({
    id: "T3",
    type: "SELL",
    tradeDate: "2025-09-02",
    settleDate: "2025-09-03",
    qty: "12",
    px: "230.00",
    mid: "3.6500",
  }),
];
// NBP table A from the business day before each settlement (§ 3.7 table), plus decoys.
const taxRates = createFxRateTable([
  nbp("USD", "3.9750", "2025-03-03"),
  nbp("USD", "3.9900", "2025-03-04"),
  nbp("USD", "3.7450", "2025-06-02"),
  nbp("USD", "3.7600", "2025-06-03"),
  nbp("USD", "3.6550", "2025-09-02"),
  nbp("USD", "3.6600", "2025-09-03"),
  nbp("USD", "3.9600", "2025-02-28"),
  nbp("USD", "3.7400", "2025-05-30"),
  nbp("USD", "3.6450", "2025-09-01"),
]);

describe("vector A — FIFO, FX, broker margin and split (obliczenia-finansowe.md § 3.7)", () => {
  const ledger = buildLedger({ accounts, transactions: vectorA, taxRates });
  const [sale] = ledger.sales;

  test("lots store economic cost, instrument-currency cost, FX fee and tax cost", () => {
    expect(ledger.lots).toHaveLength(2);
    ledger.lots.forEach((lot, index) => {
      const expected = A.lots[index];
      expect(lot.key).toBe(expected.lot);
      expect(lot.quantityAcquired.toFixed(6)).toBe(vec(expected.qty));
      expect(fixed(lot.cost, 6)).toBe(vec(expected.cost_pln));
      expect(fixed(lot.fxFee, 6)).toBe(vec(expected.fx_fee_pln));
      expect(fixed(lot.taxCost, 6)).toBe(vec(expected.tax_cost_pln));
      expect(fixed(lot.costInstrument, 6)).toBe(vec(expected.cost_usd));
      expect(lot.cost.currency).toBe("PLN");
      expect(lot.costInstrument.currency).toBe("USD");
      expect(lot.taxCost.currency).toBe("PLN");
    });
    expect(ledger.lots[0]).toMatchObject({ acquiredOn: "2025-03-03", taxDate: "2025-03-04" });
  });

  test("sale consumes T1 fully and 2 units of T2 in FIFO order", () => {
    expect(sale.consumptions).toHaveLength(2);
    sale.consumptions.forEach((c, index) => {
      const expected = A.consumed[index];
      expect(c.lotKey).toBe(expected.lot);
      expect(c.quantity.toFixed(6)).toBe(vec(expected.qty));
      expect(fixed(c.costEconomic, 6)).toBe(vec(expected.cost_pln));
      expect(fixed(c.tax.costPln, 6)).toBe(vec(expected.tax_cost_pln));
      expect(fixed(c.costInstrument, 6)).toBe(vec(expected.cost_usd));
      expect(fixed(c.lotFxFee, 6)).toBe(vec(expected.fx_fee_pln));
    });
  });

  test("economic realized P/L and proceeds", () => {
    expect(fixed(sale.proceedsEconomic)).toBe(vec(A.sell.proceeds_pln));
    expect(fixed(sale.costEconomic)).toBe("11107.26");
    expect(fixed(sale.realizedPlEconomic)).toBe(vec(A.realized_pl_economic_pln));
    expect(sale).toMatchObject({ taxStatus: "computed", tradeDate: "2025-09-02" });
    const sum = sale.consumptions.reduce(
      (acc, c) => acc.plus(c.realizedPlEconomic.amount),
      toDecimal("0"),
    );
    expect(sum.toFixed()).toBe(sale.realizedPlEconomic.amount.toFixed());
  });

  test("tax view: settle date, NBP D-1, FX margin reported separately", () => {
    expect(sale.tax.taxDate).toBe("2025-09-03");
    expect(fixed(sale.tax.proceedsPln)).toBe(vec(A.sell.proceeds_tax_pln));
    expect(fixed(sale.tax.realizedPlPln)).toBe(vec(A.realized_pl_tax_pln));
    expect(fixed(sale.tax.fxCostsPln)).toBe(vec(A.fx_costs_realized_pln));
    expect(fixed(sale.sellFxFee)).toBe(vec(A.sell.fx_fee_pln));
    expect(ledger.issues).toEqual([]);
  });

  test("tax_include_fx_fee = true moves FX costs into the tax cost", () => {
    const withFee = buildLedger({
      accounts,
      transactions: vectorA,
      taxRates,
      taxSettings: { dateBasis: "settlement", includeFxFee: true },
    }).sales[0];
    expect(fixed(withFee.tax.realizedPlPln)).toBe(vec(A.realized_pl_tax_pln_incl_fx_fee));
    expect(fixed(withFee.tax.fxCostsPln)).toBe(vec(A.fx_costs_realized_pln));
    // The economic view never depends on the tax settings.
    expect(fixed(withFee.realizedPlEconomic)).toBe(vec(A.realized_pl_economic_pln));
  });

  test("remaining lot and split 4:1 keep the cost and acquisition date", () => {
    const remaining = ledger.lots.filter((lot) => !lot.quantityRemaining.isZero());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].quantityRemaining.toFixed()).toBe(vec(A.remaining_after_sale.qty));
    expect(fixed(remaining[0].costRemaining)).toBe(vec(A.remaining_after_sale.cost_pln));
    expect(ledger.lots[0].closedOn).toBe("2025-09-02");

    const split = {
      id: "S1",
      accountId: "xtb",
      type: "SPLIT",
      tradeDate: isoDate("2025-10-01"),
      instrumentId: "AAPL",
      splitRatio: toDecimal("4"),
    };
    const after = buildLedger({ accounts, transactions: [...vectorA, split], taxRates });
    const lot = after.lots[1];
    expect(lot.quantityRemaining.toFixed()).toBe(vec(A.after_split_4_1.qty));
    expect(fixed(lot.costRemaining)).toBe(vec(A.after_split_4_1.cost_pln));
    expect(lot.unitCost.amount.toFixed(6)).toBe(vec(A.after_split_4_1.cost_per_share_pln));
    expect(lot.splitFactor.toFixed()).toBe("4");
    expect(lot.acquiredOn).toBe("2025-06-02");
    expect(ledger.lots[0].unitCost).toBeNull();
  });
});

describe("tax view settings and data gaps", () => {
  test("tax_date_basis = trade uses NBP from the day before the trade date", () => {
    const sale = buildLedger({
      accounts,
      transactions: vectorA,
      taxRates,
      taxSettings: { dateBasis: "trade", includeFxFee: false },
    }).sales[0];
    expect(sale.tax.taxDate).toBe("2025-09-02");
    // 2760 USD × 3.6450 (NBP 2025-09-01); cost: 2400 × 3.9600 + 400 × 3.7400.
    expect(fixed(sale.tax.proceedsPln)).toBe("10060.20");
    expect(fixed(sale.tax.realizedPlPln)).toBe("-939.80");
  });

  test("missing settle date or NBP rate yields issues, not a broken economic view", () => {
    const noSettle = vectorA.map((tx) => (tx.id === "T3" ? { ...tx, settleDate: undefined } : tx));
    const ledger = buildLedger({ accounts, transactions: noSettle, taxRates });
    expect(ledger.sales[0].taxStatus).toBe("missing_data");
    expect(ledger.sales[0].tax).toBeNull();
    expect(fixed(ledger.sales[0].realizedPlEconomic)).toBe(vec(A.realized_pl_economic_pln));
    expect(ledger.issues).toEqual([{ code: "missing_settle_date", transactionId: "T3" }]);

    const noRates = buildLedger({ accounts, transactions: vectorA });
    expect(noRates.lots[0].taxCost).toBeNull();
    expect(noRates.sales[0].tax).toBeNull();
    expect(noRates.issues).toContainEqual({
      code: "missing_tax_rate",
      transactionId: "T1",
      currency: "USD",
      date: "2025-03-04",
    });
    expect(noRates.issues.filter((i) => i.transactionId === "T1")).toHaveLength(1);
  });

  test("IKE/IKZE: tax view not applicable, no issues", () => {
    const onIke = vectorA.map((tx) => ({ ...tx, accountId: "ike", settleDate: undefined }));
    const ledger = buildLedger({ accounts, transactions: onIke });
    expect(ledger.sales[0]).toMatchObject({ taxStatus: "not_applicable", tax: null });
    expect(ledger.lots[0].taxCost).toBeNull();
    expect(ledger.issues).toEqual([]);
    expect(fixed(ledger.sales[0].realizedPlEconomic)).toBe(vec(A.realized_pl_economic_pln));
  });
});

/** GPW share on a PLN account in mBank: commission in PLN, no FX. */
function plnTrade(id, type, tradeDate, qty, px, fee, extra = {}) {
  const gross = toDecimal(qty).times(px);
  const cash = type === "BUY" ? gross.plus(fee).negated() : gross.minus(fee);
  return {
    id,
    accountId: "mbank",
    type,
    tradeDate: isoDate(tradeDate),
    settleDate: isoDate(tradeDate),
    instrumentId: "PKO",
    quantity: quantity(qty),
    price: price(px, "PLN"),
    amount: money(cash, "PLN"),
    fee: money(fee, "PLN"),
    ...extra,
  };
}

describe("FIFO on a PLN instrument with commissions", () => {
  const transactions = [
    plnTrade("B1", "BUY", "2024-01-10", "100", "40.00", "15.00"),
    plnTrade("B2", "BUY", "2024-02-10", "50", "44.00", "8.80"),
    plnTrade("S1", "SELL", "2024-03-11", "30", "50.00", "6.00"),
    plnTrade("S2", "SELL", "2024-04-10", "100", "48.00", "19.20"),
  ];
  const ledger = buildLedger({ accounts, transactions });

  test("partial sales split lot costs proportionally and exactly", () => {
    const [s1, s2] = ledger.sales;
    // S1: 30/100 of B1 (4015.00) = 1204.50; proceeds 1494.00.
    expect(fixed(s1.costEconomic)).toBe("1204.50");
    expect(fixed(s1.realizedPlEconomic)).toBe("289.50");
    // S2: 70 from B1 (2810.50) + 30 from B2 (30/50 of 2208.80 = 1325.28); proceeds 4780.80.
    expect(s2.consumptions.map((c) => [c.lotKey, c.quantity.toFixed()])).toEqual([
      ["B1", "70"],
      ["B2", "30"],
    ]);
    expect(fixed(s2.costEconomic)).toBe("4135.78");
    expect(fixed(s2.realizedPlEconomic)).toBe("645.02");
    const b2 = ledger.lots[1];
    expect(b2.quantityRemaining.toFixed()).toBe("20");
    expect(fixed(b2.costRemaining)).toBe("883.52");
  });

  test("tax view equals the economic view without FX", () => {
    for (const sale of ledger.sales) {
      expect(fixed(sale.tax.realizedPlPln)).toBe(fixed(sale.realizedPlEconomic));
      expect(fixed(sale.tax.fxCostsPln)).toBe("0.00");
    }
  });

  test("selling more than held is a data error (import row error: short_position)", () => {
    const tooMuch = [...transactions, plnTrade("S3", "SELL", "2024-05-10", "21", "40.00", "0")];
    const error = (() => {
      try {
        buildLedger({ accounts, transactions: tooMuch });
      } catch (e) {
        return e;
      }
    })();
    expect(error.code).toBe("short_position");
    expect(error.details).toMatchObject({ transactionId: "S3", available: "20", requested: "21" });
  });
});

describe("foreign commissions and transaction taxes", () => {
  test("USD commission and transaction tax: NBP D-1 in the tax view, included in K_i", () => {
    const base = usdTrade({
      id: "U1",
      type: "BUY",
      tradeDate: "2025-03-03",
      settleDate: "2025-03-04",
      qty: "10",
      px: "240.00",
      mid: "3.9800",
    });
    const buy = {
      ...base,
      fee: money("1.00", "USD"),
      amount: money(base.amount.amount.minus("3.9999"), "PLN"),
    };
    const sellBase = usdTrade({
      id: "U2",
      type: "SELL",
      tradeDate: "2025-09-02",
      settleDate: "2025-09-03",
      qty: "10",
      px: "230.00",
      mid: "3.6500",
    });
    const sell = {
      ...sellBase,
      fee: money("1.00", "USD"),
      tax: money("0.50", "USD"),
      amount: money(sellBase.amount.amount.minus("5.447625"), "PLN"),
    };
    const ledger = buildLedger({ accounts, transactions: [buy, sell], taxRates });
    expect(fixed(ledger.lots[0].costInstrument)).toBe("2401.00");
    expect(fixed(ledger.lots[0].taxCost, 4)).toBe("9543.9750");
    const sale = ledger.sales[0];
    // (2300 − 1 − 0.5) USD × 3.6550 = 8401.0175 PLN.
    expect(fixed(sale.tax.proceedsPln, 4)).toBe("8401.0175");
    expect(fixed(sale.consumptions[0].proceedsInstrument)).toBe("2298.50");
  });
});

describe("security transfers between own accounts (§ 3.5)", () => {
  const second = { id: "xtb2", currency: "PLN", accountType: "regular" };
  const buyOld = plnTrade("B0", "BUY", "2023-01-10", "10", "30.00", "0");
  const buyNew = { ...plnTrade("B9", "BUY", "2024-06-10", "5", "50.00", "0"), accountId: "xtb2" };
  const out = {
    id: "OUT",
    accountId: "mbank",
    type: "SECURITY_TRANSFER_OUT",
    tradeDate: isoDate("2024-07-01"),
    instrumentId: "PKO",
    quantity: quantity("10"),
  };
  const inbound = {
    id: "IN",
    accountId: "xtb2",
    type: "SECURITY_TRANSFER_IN",
    tradeDate: isoDate("2024-07-01"),
    sequence: 1,
    instrumentId: "PKO",
    quantity: quantity("10"),
    relatedTransactionId: "OUT",
  };
  const sellOnTarget = {
    ...plnTrade("S9", "SELL", "2024-08-01", "12", "60.00", "0"),
    accountId: "xtb2",
  };

  test("lots move with their original date and cost; FIFO then uses the original date", () => {
    const ledger = buildLedger({
      accounts: [...accounts, second],
      transactions: [buyOld, buyNew, out, inbound, sellOnTarget],
    });
    const moved = ledger.lots.find(
      (lot) => lot.accountId === "xtb2" && lot.originTransactionId === "B0",
    );
    expect(moved).toMatchObject({
      key: "IN/B0",
      openTransactionId: "IN",
      acquiredOn: "2023-01-10",
    });
    expect(fixed(moved.cost)).toBe("300.00");
    const sale = ledger.sales[0];
    expect(sale.consumptions.map((c) => [c.lotKey, c.quantity.toFixed()])).toEqual([
      ["IN/B0", "10"],
      ["B9", "2"],
    ]);
    expect(fixed(sale.costEconomic)).toBe("400.00");
    expect(ledger.lots.find((lot) => lot.key === "B0").closedOn).toBe("2024-07-01");
  });

  test("a linked inbound leg must follow its outbound leg with the same quantity", () => {
    const all = [...accounts, second];
    // The OUT exists but is processed later (sequence): an ordering error, not an external transfer.
    const early = { ...out, sequence: 5 };
    const lateIn = { ...inbound, sequence: 0 };
    expect(
      codeOf(() => buildLedger({ accounts: all, transactions: [buyOld, lateIn, early] })),
    ).toBe("unmatched_security_transfer");
    const wrongQty = { ...inbound, quantity: quantity("9") };
    expect(
      codeOf(() => buildLedger({ accounts: all, transactions: [buyOld, out, wrongQty] })),
    ).toBe("unmatched_security_transfer");
    const linkedFromOut = { ...out, relatedTransactionId: "IN" };
    const { relatedTransactionId: _, ...unlinkedIn } = inbound;
    const ledger = buildLedger({
      accounts: all,
      transactions: [buyOld, linkedFromOut, unlinkedIn],
    });
    expect(ledger.lots.at(-1).key).toBe("IN/B0");
    expect(codeOf(() => buildLedger({ accounts: all, transactions: [out] }))).toBe(
      "short_position",
    );
  });

  test("inbound transfer from outside with a declared cost and acquisition date", () => {
    const all = [...accounts, second];
    const external = {
      ...inbound,
      relatedTransactionId: undefined,
      acquisitionCost: money("280.00", "PLN"),
      acquiredOn: isoDate("2022-05-05"),
    };
    const ledger = buildLedger({ accounts: all, transactions: [buyNew, external, sellOnTarget] });
    const lot = ledger.lots.find((l) => l.key === "IN");
    expect(lot).toMatchObject({ acquiredOn: "2022-05-05", costKnown: true, costInstrument: null });
    expect(lot.taxCost.amount.toFixed(2)).toBe("280.00");
    // FIFO uses the declared date: the transferred lot is sold first.
    expect(ledger.sales[0].consumptions.map((c) => c.lotKey)).toEqual(["IN", "B9"]);
    expect(ledger.sales[0].costEconomic.amount.toFixed(2)).toBe("380.00");
    expect(ledger.sales[0].taxStatus).toBe("computed");
    expect(ledger.issues).toEqual([]);
    const halfDeclared = { ...external, acquiredOn: undefined };
    expect(codeOf(() => buildLedger({ accounts: all, transactions: [halfDeclared] }))).toBe(
      "invalid_transaction",
    );
    const wrongCurrency = { ...external, acquisitionCost: money("1", "USD") };
    expect(codeOf(() => buildLedger({ accounts: all, transactions: [wrongCurrency] }))).toBe(
      "invalid_transaction",
    );
  });

  test("inbound transfer without a cost: valued, but excluded from P/L and the tax view", () => {
    const all = [...accounts, second];
    const unknown = { ...inbound, relatedTransactionId: undefined };
    const ledger = buildLedger({ accounts: all, transactions: [buyNew, unknown, sellOnTarget] });
    expect(ledger.issues).toEqual([{ code: "missing_acquisition_cost", transactionId: "IN" }]);
    const lot = ledger.lots.find((l) => l.key === "IN");
    expect(lot).toMatchObject({
      costKnown: false,
      cost: null,
      costRemaining: null,
      unitCost: null,
      taxCost: null,
    });
    const [sale] = ledger.sales;
    expect(sale).toMatchObject({
      costEconomic: null,
      realizedPlEconomic: null,
      taxStatus: "missing_data",
      tax: null,
    });
    // Without a declared date the lot is dated on the transfer day: B9 (older) goes first.
    expect(sale.consumptions.map((c) => c.lotKey)).toEqual(["B9", "IN"]);
    expect(sale.consumptions[0].realizedPlEconomic.amount.toFixed(2)).toBe("50.00");
    expect(sale.consumptions[1]).toMatchObject({
      costKnown: false,
      costEconomic: null,
      realizedPlEconomic: null,
    });
    const [position] = ledger.positions;
    expect(position.quantity.toFixed()).toBe("3");
    expect(position).toMatchObject({ costKnown: false, cost: null });
    const held = buildLedger({ accounts: all, transactions: [buyNew, unknown] });
    expect(held.positions[0]).toMatchObject({ costKnown: false, cost: null, taxCost: null });
    expect(held.positions[0].quantity.toFixed()).toBe("15");
  });

  test("an outbound leg without an inbound leg removes the lots from the portfolio", () => {
    const ledger = buildLedger({ accounts, transactions: [buyOld, out] });
    expect(ledger.lots[0].quantityRemaining.isZero()).toBe(true);
    expect(ledger.sales).toEqual([]);
  });
});

describe("processing order (§ 1)", () => {
  test("date, SPLIT first, executedAt (untimed last), sequence, id — a total order", () => {
    const tx = (id, type, tradeDate, extra = {}) => ({
      id,
      accountId: "mbank",
      type,
      tradeDate,
      ...extra,
    });
    const input = [
      tx("c", "BUY", "2025-01-02", { sequence: 2 }),
      tx("b", "BUY", "2025-01-02", { sequence: 2 }),
      tx("d", "BUY", "2025-01-02", { sequence: 1 }),
      tx("x", "SPLIT", "2025-01-02", { sequence: 9 }),
      tx("t2", "SELL", "2025-01-02", { executedAt: "2025-01-02T10:00:00Z", sequence: 0 }),
      tx("t1", "SELL", "2025-01-02", { executedAt: "2025-01-02T10:00:00+01:00", sequence: 5 }),
      tx("a", "BUY", "2025-01-01", { sequence: 7 }),
    ];
    const expected = ["a", "x", "t1", "t2", "d", "b", "c"];
    expect(sortTransactions(input).map((t) => t.id)).toEqual(expected);
    expect(sortTransactions([...input].reverse()).map((t) => t.id)).toEqual(expected);
    expect(input[0].id).toBe("c");
  });

  test("a split dated with the trades applies before them", () => {
    const buy = plnTrade("B1", "BUY", "2024-01-10", "10", "40.00", "0");
    const sell = plnTrade("S1", "SELL", "2024-02-01", "20", "21.00", "0", { sequence: 0 });
    const split = {
      id: "SP",
      accountId: "mbank",
      type: "SPLIT",
      tradeDate: isoDate("2024-02-01"),
      sequence: 5,
      instrumentId: "PKO",
      splitRatio: toDecimal("2"),
    };
    const ledger = buildLedger({ accounts, transactions: [sell, split, buy] });
    expect(fixed(ledger.sales[0].realizedPlEconomic)).toBe("20.00");
  });

  test("reverse split 1:10 scales quantity and unit cost", () => {
    const buy = plnTrade("B1", "BUY", "2024-01-10", "25", "4.00", "0");
    const split = {
      id: "SP",
      accountId: "mbank",
      type: "SPLIT",
      tradeDate: isoDate("2024-02-01"),
      instrumentId: "PKO",
      splitRatio: toDecimal("0.1"),
    };
    const lot = buildLedger({ accounts, transactions: [buy, split] }).lots[0];
    expect(lot.quantityRemaining.toFixed()).toBe("2.5");
    expect(fixed(lot.unitCost)).toBe("40.00");
  });
});

describe("validation per operation type (schema.sql constraints)", () => {
  const buy = plnTrade("B1", "BUY", "2024-01-10", "10", "40.00", "1.00");
  const cases = [
    ["unknown account", { ...buy, accountId: "nope" }, "invalid_account"],
    ["BUY with a positive amount", { ...buy, amount: money("400", "PLN") }, "invalid_transaction"],
    [
      "SELL with a negative amount",
      { ...buy, type: "SELL", amount: money("-1", "PLN") },
      "invalid_transaction",
    ],
    ["zero quantity", { ...buy, quantity: quantity("0") }, "invalid_transaction"],
    ["negative fee", { ...buy, fee: money("-1", "PLN") }, "invalid_transaction"],
    [
      "amount not in account currency",
      { ...buy, amount: money("-401", "USD") },
      "invalid_transaction",
    ],
    ["FX fee in another currency", { ...buy, fxFee: money("1", "USD") }, "invalid_transaction"],
    ["missing instrument", { ...buy, instrumentId: "" }, "invalid_transaction"],
    ["float quantity", { ...buy, quantity: 10 }, "invalid_transaction"],
    ["invalid trade date", { ...buy, tradeDate: "2024-02-30" }, "invalid_date"],
    ["invalid executedAt", { ...buy, executedAt: "yesterday" }, "invalid_transaction"],
    ["fractional sequence", { ...buy, sequence: 1.5 }, "invalid_transaction"],
    ["unknown type", { ...buy, type: "SHORT" }, "invalid_transaction"],
    [
      "split ratio zero",
      {
        id: "S",
        accountId: "mbank",
        type: "SPLIT",
        tradeDate: "2024-01-01",
        instrumentId: "PKO",
        splitRatio: toDecimal("0"),
      },
      "invalid_transaction",
    ],
    ["duplicate id", null, "invalid_transaction"],
  ];
  test.each(cases)("%s", (_name, bad, code) => {
    const transactions = bad === null ? [buy, buy] : [bad];
    expect(codeOf(() => buildLedger({ accounts, transactions }))).toBe(code);
  });

  test("accounts are validated", () => {
    expect(
      codeOf(() =>
        buildLedger({
          accounts: [{ id: "a", currency: "PLN", accountType: "margin" }],
          transactions: [],
        }),
      ),
    ).toBe("invalid_account");
    expect(
      codeOf(() => buildLedger({ accounts: [accounts[0], accounts[0]], transactions: [] })),
    ).toBe("invalid_account");
  });
});
