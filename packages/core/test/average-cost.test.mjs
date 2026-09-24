import {
  brokerFxRate,
  buildAverageCostView,
  convertMoney,
  fxRate,
  grossValue,
  isCoreError,
  isoDate,
  money,
  negateMoney,
  price,
  quantity,
  roundMoney,
  toDecimal,
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

describe("weighted average cost as a view (§ 3.3) — vector A", () => {
  test("average after purchases and realized P/L of the sale", () => {
    const view = buildAverageCostView({ accounts, transactions: vectorA });
    const [sale] = view.sales;
    expect(sale.unitCost.amount.toFixed(6)).toBe(
      readDecimalText(A.average_cost.avg_cost_per_share_pln),
    );
    expect(rounded(sale.realizedPl)).toBe(readDecimalText(A.average_cost.realized_pl_pln));
    const [position] = view.positions;
    expect(position.quantity.toFixed()).toBe("3");
    // A sale does not change the average of the remaining units.
    expect(position.unitCost.amount.toFixed(6)).toBe(
      readDecimalText(A.average_cost.avg_cost_per_share_pln),
    );
    expect(rounded(position.cost)).toBe("2673.70");
  });

  test("purchases re-average; splits rescale; transfers carry the average", () => {
    const txs = [
      ...vectorA,
      usdTrade("T4", "BUY", "2025-10-01", "3", "250.00", "3.6000"),
      {
        id: "SP",
        accountId: "xtb",
        type: "SPLIT",
        tradeDate: d("2025-11-03"),
        instrumentId: "AAPL",
        ratioFrom: 1,
        ratioTo: 2,
      },
      {
        id: "OUT",
        accountId: "xtb",
        type: "SECURITY_TRANSFER_OUT",
        tradeDate: d("2025-12-01"),
        instrumentId: "AAPL",
        quantity: quantity("6"),
      },
      {
        id: "IN",
        accountId: "xtb2",
        type: "SECURITY_TRANSFER_IN",
        tradeDate: d("2025-12-01"),
        sequence: 1,
        instrumentId: "AAPL",
        quantity: quantity("6"),
        relatedTransactionId: "OUT",
      },
    ];
    const view = buildAverageCostView({ accounts, transactions: txs });
    const [left, moved] = view.positions;
    // (2673.702 + 3 × 250 × 3.6 × 1.005) / 6 units, then split 2:1 → 12 units at half the average.
    const avg = toDecimal("2673.702").plus("2713.5").div(6).div(2);
    expect(left).toMatchObject({ accountId: "xtb" });
    expect(left.quantity.toFixed()).toBe("6");
    expect(left.unitCost.amount.toFixed(10)).toBe(avg.toFixed(10));
    expect(moved).toMatchObject({ accountId: "xtb2" });
    expect(moved.cost.amount.toFixed(10)).toBe(avg.times(6).toFixed(10));
    // The link may also sit on the outbound leg; cash operations do not affect the view.
    const linkedFromOut = txs.map((t) =>
      t.id === "OUT"
        ? { ...t, relatedTransactionId: "IN" }
        : t.id === "IN"
          ? { ...t, relatedTransactionId: undefined }
          : t,
    );
    const deposit = {
      id: "DEP",
      accountId: "xtb",
      type: "DEPOSIT",
      tradeDate: d("2025-01-02"),
      amount: money("100", "PLN"),
    };
    const again = buildAverageCostView({ accounts, transactions: [deposit, ...linkedFromOut] });
    expect(again.positions[1].cost.amount.toFixed()).toBe(moved.cost.amount.toFixed());
    const reordered = txs.map((t) => (t.id === "OUT" ? { ...t, sequence: 5 } : t));
    expect(codeOf(() => buildAverageCostView({ accounts, transactions: reordered }))).toBe(
      "unmatched_security_transfer",
    );
    const short = [...vectorA, usdTrade("T9", "SELL", "2025-10-01", "4", "1", "3.6")];
    expect(codeOf(() => buildAverageCostView({ accounts, transactions: short }))).toBe(
      "short_position",
    );
  });
});

describe("average cost with transfers from outside (owner decision 2026-09-24)", () => {
  const inbound = (extra = {}) => ({
    id: "IN",
    accountId: "xtb",
    type: "SECURITY_TRANSFER_IN",
    tradeDate: d("2025-01-02"),
    instrumentId: "AAPL",
    quantity: quantity("10"),
    ...extra,
  });

  test("a declared cost enters the average", () => {
    const view = buildAverageCostView({
      accounts,
      transactions: [
        inbound({ acquisitionCost: money("1000", "PLN"), acquiredOn: d("2020-01-02") }),
      ],
    });
    expect(view.positions[0].unitCost.amount.toFixed()).toBe("100");
  });

  test("without a cost the average and the realized P/L are unknown until the pool empties", () => {
    const sell = (id, date, qty) => ({ ...usdTrade(id, "SELL", date, qty, "240.00", "3.9800") });
    const view = buildAverageCostView({
      accounts,
      transactions: [
        inbound(),
        sell("S1", "2025-02-03", "10"),
        usdTrade("B1", "BUY", "2025-03-03", "2", "240.00", "3.9800"),
        sell("S2", "2025-04-01", "1"),
      ],
    });
    expect(view.sales[0]).toMatchObject({ unitCost: null, cost: null, realizedPl: null });
    expect(view.sales[1].realizedPl).not.toBeNull();
    expect(view.positions[0].unitCost).not.toBeNull();
    const held = buildAverageCostView({ accounts, transactions: [inbound()] });
    expect(held.positions[0]).toMatchObject({ cost: null, unitCost: null });
  });
});
