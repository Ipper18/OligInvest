import {
  buildLedger,
  createFxRateTable,
  fxRate,
  isCoreError,
  isoDate,
  money,
  price,
  quantity,
  rebalance,
  toDecimal,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const H = loadTestVectors().H_rebalance;
const pln = (v) => money(v, "PLN");
const signed = (trade) => trade.amount.amount.toFixed(2);
const pct = (w) => `${toDecimal(String(w)).times(100).toFixed(2)}%`;

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

const holdingsH = Object.entries(H.current).map(([instrumentId, value]) => ({
  instrumentId,
  value: pln(readDecimalText(value)),
}));
const targetsH = Object.entries(H.target).map(([instrumentId, weight]) => ({
  instrumentId,
  weight: readDecimalText(weight),
}));
const base = { holdings: holdingsH, targets: targetsH, reconciled: true, taxable: false };

describe("rebalancing (obliczenia-finansowe.md § 12.5), vector H", () => {
  test("full: trades t_i·W − V_i", () => {
    const result = rebalance({ ...base, mode: "full" });
    expect(result.status).toBe("ok");
    const byId = Object.fromEntries(result.trades.map((t) => [t.instrumentId, t]));
    for (const [id, amount] of Object.entries(H.full_rebalance_trades)) {
      expect(signed(byId[id])).toBe(readDecimalText(amount));
    }
    expect(byId.ETF_A.side).toBe("sell");
    expect(byId.ETF_B.side).toBe("buy");
  });

  test("buy_only: new cash split in proportion to the positive gaps", () => {
    const result = rebalance({
      ...base,
      mode: "buy_only",
      newCash: pln(readDecimalText(H.buy_only_new_cash)),
    });
    const byId = Object.fromEntries(result.trades.map((t) => [t.instrumentId, t]));
    for (const [id, amount] of Object.entries(H.buy_only_allocation)) {
      expect(signed(byId[id])).toBe(readDecimalText(amount));
    }
    const after = Object.fromEntries(
      result.weightsAfter.map((w) => [w.instrumentId, pct(w.weight)]),
    );
    expect(after).toEqual(H.weights_after_buy_only);
    expect(result.cashAfter.amount.isZero()).toBe(true);
  });
});

describe("rules of § 12.5", () => {
  test("blocked without a reconciled import: no trade list (§ 13.2)", () => {
    const result = rebalance({ ...base, mode: "full", reconciled: false });
    expect(result).toMatchObject({ status: "blocked", trades: [] });
  });

  test("instruments within the tolerance band are skipped", () => {
    const holdings = [
      { instrumentId: "ETF_A", value: pln("6200") },
      { instrumentId: "ETF_B", value: pln("3800") },
    ];
    const result = rebalance({ ...base, holdings, mode: "full" });
    expect(result.trades).toEqual([]);
    expect(result.skipped).toEqual(["ETF_A", "ETF_B"]);
    const tight = rebalance({ ...base, holdings, mode: "full", band: "0.01" });
    expect(tight.trades.map(signed)).toEqual(["-200.00", "200.00"]);
  });

  test("whole units: buys round down, sells to the nearest unit; costs and FIFO tax", () => {
    const ledger = buildLedger({
      accounts: [{ id: "a", currency: "PLN", accountType: "regular" }],
      transactions: [
        {
          id: "B1",
          accountId: "a",
          type: "BUY",
          tradeDate: isoDate("2024-01-02"),
          settleDate: isoDate("2024-01-04"),
          instrumentId: "A",
          quantity: quantity("70"),
          price: price("80", "PLN"),
          amount: pln("-5600"),
        },
      ],
    });
    const holdings = [
      {
        instrumentId: "A",
        value: pln("7000"),
        unitPrice: pln("100"),
        lots: ledger.positions[0].lots,
      },
      { instrumentId: "B", value: pln("3000"), unitPrice: pln("300") },
    ];
    const result = rebalance({
      holdings,
      targets: [
        { instrumentId: "A", weight: "0.5" },
        { instrumentId: "B", weight: "0.5" },
      ],
      newCash: pln("1000"),
      mode: "full",
      costRate: "0.001",
      minCost: pln("5"),
      taxable: true,
      reconciled: true,
    });
    const [a, b] = result.trades;
    expect(a).toMatchObject({ instrumentId: "A", side: "sell" });
    expect(a.quantity.toFixed()).toBe("15");
    expect(signed(a)).toBe("-1500.00");
    expect(b.quantity.toFixed()).toBe("8");
    expect(signed(b)).toBe("2400.00");
    expect(a.cost.amount.toFixed(2)).toBe("5.00");
    expect(b.cost.amount.toFixed(2)).toBe("5.00");
    // Proceeds 1500 − 5, FIFO tax-view cost 15 × 80 = 1200 → gain 295, 19 % = 56.05 (estimate).
    expect(a.estimatedTax.amount.toFixed(2)).toBe("56.05");
    expect(b.estimatedTax.amount.toFixed(2)).toBe("0.00");
    expect(result.estimatedTax.amount.toFixed(2)).toBe("56.05");
    expect(result.costs.amount.toFixed(2)).toBe("10.00");
    expect(result.cashAfter.amount.toFixed(2)).toBe("90.00");
    expect(result.weightsAfter.map((w) => w.weight)).toEqual([5500 / 10990, 5400 / 10990]);
  });

  test("leftover cash buys more whole units while the target allows", () => {
    const holdings = [
      { instrumentId: "A", value: pln("0"), unitPrice: pln("30") },
      { instrumentId: "B", value: pln("0"), unitPrice: pln("45") },
    ];
    const result = rebalance({
      holdings,
      targets: [
        { instrumentId: "A", weight: "0.5" },
        { instrumentId: "B", weight: "0.5" },
      ],
      newCash: pln("200"),
      mode: "buy_only",
      taxable: false,
      reconciled: true,
    });
    // 100 each: A 3 units (90), B 2 units (90); 20 left, no unit fits under a target.
    expect(result.trades.map((t) => [t.instrumentId, t.quantity.toFixed()])).toEqual([
      ["A", "3"],
      ["B", "2"],
    ]);
    const wider = rebalance({
      holdings,
      targets: [
        { instrumentId: "A", weight: "0.6" },
        { instrumentId: "B", weight: "0.4" },
      ],
      newCash: pln("300"),
      mode: "buy_only",
      taxable: false,
      reconciled: true,
    });
    // A 180 → 6 units, B 120 → 2 units (90); the 30 left fits no unit below a target.
    expect(wider.trades.map((t) => t.quantity.toFixed())).toEqual(["6", "2"]);
    expect(wider.cashAfter.amount.toFixed(2)).toBe("30.00");
  });

  test("orders below the minimum value are dropped; fractional shares keep exact amounts", () => {
    const result = rebalance({
      ...base,
      mode: "buy_only",
      newCash: pln("2000"),
      minOrder: pln("500"),
    });
    expect(result.trades.map((t) => t.instrumentId)).toEqual(["ETF_B"]);
    expect(result.cashAfter.amount.toFixed(2)).toBe("200.00");
    const fractional = rebalance({
      ...base,
      holdings: holdingsH.map((h) => ({ ...h, unitPrice: pln("300"), fractional: true })),
      mode: "full",
    });
    expect(fractional.trades.map((t) => t.quantity.toFixed(6))).toEqual(["3.333333", "3.333333"]);
  });

  test("tax is unknown without lots on a taxable account; zero on IKE", () => {
    const taxed = rebalance({ ...base, mode: "full", taxable: true });
    expect(taxed.trades[0].estimatedTax).toBeNull();
    expect(taxed.estimatedTax).toBeNull();
    expect(rebalance({ ...base, mode: "full" }).estimatedTax.amount.isZero()).toBe(true);
  });

  test("invalid allocations are rejected", () => {
    const bad = (targets, extra = {}) =>
      codeOf(() => rebalance({ ...base, mode: "full", targets, ...extra }));
    expect(
      bad([
        { instrumentId: "ETF_A", weight: "0.5" },
        { instrumentId: "ETF_B", weight: "0.4" },
      ]),
    ).toBe("invalid_allocation");
    expect(
      bad([
        { instrumentId: "ETF_A", weight: "1.5" },
        { instrumentId: "ETF_B", weight: "-0.5" },
      ]),
    ).toBe("invalid_allocation");
    expect(bad([{ instrumentId: "ETF_C", weight: "1" }])).toBe("invalid_allocation");
    expect(bad(targetsH, { band: "-0.1" })).toBe("invalid_allocation");
    expect(bad(targetsH, { newCash: money("1", "EUR") })).toBe("currency_mismatch");
    expect(bad(targetsH, { holdings: [...holdingsH, holdingsH[0]] })).toBe("invalid_allocation");
  });

  test("held instruments without a target are sold in full mode", () => {
    const result = rebalance({
      ...base,
      targets: [{ instrumentId: "ETF_B", weight: "1" }],
      mode: "full",
    });
    expect(result.trades.map(signed)).toEqual(["-7000.00", "7000.00"]);
  });

  test("purchases beyond the available cash are trimmed (band skips, costs)", () => {
    const holdings = [
      { instrumentId: "A", value: pln("5300") },
      { instrumentId: "B", value: pln("3700") },
    ];
    const targets = [
      { instrumentId: "A", weight: "0.5" },
      { instrumentId: "B", weight: "0.5" },
    ];
    const common = { targets, cash: pln("1000"), mode: "full", taxable: false, reconciled: true };
    // A is within the band (53 % vs 50 %), so B's gap of 1300 exceeds the 1000 of cash.
    const exact = rebalance({ ...common, holdings });
    expect(exact.skipped).toEqual(["A"]);
    expect(exact.trades.map(signed)).toEqual(["1000.00"]);
    expect(exact.cashAfter.amount.isZero()).toBe(true);
    const whole = rebalance({
      ...common,
      holdings: holdings.map((h) => ({ ...h, unitPrice: pln("100") })),
      costRate: "0.01",
    });
    expect(whole.trades[0].quantity.toFixed()).toBe("9");
    expect(whole.cashAfter.amount.toFixed(2)).toBe("91.00");
  });

  test("without quantities the FIFO basis is taken in proportion to the value sold", () => {
    const ledger = buildLedger({
      accounts: [{ id: "a", currency: "PLN", accountType: "regular" }],
      transactions: [
        {
          id: "B1",
          accountId: "a",
          type: "BUY",
          tradeDate: isoDate("2024-01-02"),
          settleDate: isoDate("2024-01-04"),
          instrumentId: "ETF_A",
          quantity: quantity("70"),
          price: price("80", "PLN"),
          amount: pln("-5600"),
        },
      ],
    });
    const holdings = holdingsH.map((h) =>
      h.instrumentId === "ETF_A" ? { ...h, lots: ledger.positions[0].lots } : h,
    );
    const result = rebalance({ ...base, holdings, mode: "full", taxable: true });
    // 1000 of 7000 sold → 10 of 70 units, basis 800, gain 200, tax 38.
    expect(result.trades[0].estimatedTax.amount.toFixed(2)).toBe("38.00");
    expect(
      codeOf(() =>
        rebalance({
          ...base,
          mode: "full",
          holdings: [{ ...holdingsH[0], unitPrice: pln("0") }, holdingsH[1]],
        }),
      ),
    ).toBe("invalid_allocation");
    expect(codeOf(() => rebalance({ ...base, mode: "full", costRate: "-0.01" }))).toBe(
      "invalid_allocation",
    );
  });

  test("the estimated tax uses the tax-view cost (NBP D-1, FX margin excluded), not the economic one", () => {
    const ledger = buildLedger({
      accounts: [{ id: "a", currency: "PLN", accountType: "regular" }],
      taxRates: createFxRateTable([
        fxRate({ base: "USD", quote: "PLN", rate: "3.90", date: "2025-03-03", source: "nbp" }),
      ]),
      transactions: [
        {
          id: "B1",
          accountId: "a",
          type: "BUY",
          tradeDate: isoDate("2025-03-03"),
          settleDate: isoDate("2025-03-04"),
          instrumentId: "US",
          quantity: quantity("10"),
          price: price("100", "USD"),
          // 1000 USD at mid 4.00 + 0.5 % margin: economic cost 4020, FX fee 20.
          amount: pln("-4020"),
          fxFee: pln("20"),
        },
      ],
    });
    const lots = ledger.positions[0].lots;
    expect(lots[0].taxCost.amount.toFixed()).toBe("3900");
    const result = rebalance({
      holdings: [
        { instrumentId: "US", value: pln("4500"), unitPrice: pln("450"), lots },
        { instrumentId: "PL", value: pln("0"), unitPrice: pln("10") },
      ],
      targets: [
        { instrumentId: "US", weight: "0" },
        { instrumentId: "PL", weight: "1" },
      ],
      mode: "full",
      taxable: true,
      reconciled: true,
    });
    // Gain 4500 − 3900 = 600 → 114.00 (the economic cost 4020 would give 91.20).
    expect(result.trades[0].estimatedTax.amount.toFixed(2)).toBe("114.00");
    const onIke = buildLedger({
      accounts: [{ id: "a", currency: "PLN", accountType: "ike" }],
      transactions: [
        {
          id: "B1",
          accountId: "a",
          type: "BUY",
          tradeDate: isoDate("2025-03-03"),
          instrumentId: "US",
          quantity: quantity("10"),
          price: price("100", "PLN"),
          amount: pln("-1000"),
        },
      ],
    });
    const noTaxCost = rebalance({
      holdings: [
        { instrumentId: "US", value: pln("4500"), lots: onIke.positions[0].lots },
        { instrumentId: "PL", value: pln("0") },
      ],
      targets: [{ instrumentId: "PL", weight: "1" }],
      mode: "full",
      taxable: true,
      reconciled: true,
    });
    expect(noTaxCost.trades[0].estimatedTax).toBeNull();
  });
});
