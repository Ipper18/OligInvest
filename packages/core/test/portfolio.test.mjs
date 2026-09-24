import {
  brokerFxRate,
  buildLedger,
  convertMoney,
  createFxRateTable,
  dayChange,
  dividendTaxView,
  externalFlows,
  fxRate,
  isCoreError,
  isoDate,
  money,
  price,
  quantity,
  roundMoney,
  toDecimal,
  valuePortfolio,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const { F_day_change: F, G_dividend: G } = loadTestVectors();
const fixed = (m, places = 2) => m.amount.toFixed(places);
const rounded = (m) => roundMoney(m).amount.toFixed(2);

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

const accounts = [
  { id: "xtb", currency: "PLN", accountType: "regular" },
  { id: "usd", currency: "USD", accountType: "regular" },
  { id: "ikze", currency: "PLN", accountType: "ikze" },
];
const d = isoDate;
const cash = (id, type, date, amount, currency = "PLN", extra = {}) => ({
  id,
  accountId: "xtb",
  type,
  tradeDate: d(date),
  amount: money(amount, currency),
  ...extra,
});
const trade = (id, type, date, qty, px, ccy, amount, extra = {}) => ({
  id,
  accountId: "xtb",
  type,
  tradeDate: d(date),
  settleDate: d(date),
  instrumentId: extra.instrumentId ?? "VWCE",
  quantity: quantity(qty),
  price: price(px, ccy),
  amount: money(amount, "PLN"),
  ...extra,
});

describe("vector G — dividend with withholding tax (obliczenia-finansowe.md § 4.3)", () => {
  const nbp = fxRate({
    base: "USD",
    quote: "PLN",
    rate: "3.6900",
    date: "2025-08-13",
    source: "nbp",
  });
  const gross = money("25.00", "USD");
  const wht = money("3.75", "USD");

  test("economic credit: net at the broker bid rate 3.68 × (1 − 0.5 %)", () => {
    const net = money(gross.amount.minus(wht.amount), "USD");
    expect(net.amount.toFixed(4)).toBe(readDecimalText(G.net_usd));
    const mid = fxRate({
      base: "USD",
      quote: "PLN",
      rate: "3.68",
      date: "2025-08-14",
      source: "manual",
    });
    const credited = convertMoney(net, brokerFxRate(mid, "0.005", "sell"));
    expect(rounded(credited)).toBe(readDecimalText(G.credited_pln_economic));
  });

  test("tax view: 19 % of gross at NBP D-1, withholding credit, estimated top-up", () => {
    const view = dividendTaxView({
      gross,
      withholdingTax: wht,
      taxDate: d("2025-08-14"),
      rate: nbp,
    });
    expect(fixed(gross)).toBe(readDecimalText(G.gross_usd));
    expect(wht.amount.toFixed(4)).toBe(readDecimalText(G.wht_usd));
    expect(rounded(view.grossPln)).toBe(readDecimalText(G.gross_pln_tax_view));
    expect(rounded(view.taxDuePln)).toBe(readDecimalText(G.pl_tax_19_pln));
    expect(rounded(view.withholdingCreditPln)).toBe(readDecimalText(G.wht_credit_pln));
    expect(rounded(view.topUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
    expect(view.taxDate).toBe("2025-08-14");
  });

  test("the credit never exceeds the Polish tax, so the top-up is never negative", () => {
    const view = dividendTaxView({
      gross,
      withholdingTax: money("7.50", "USD"),
      taxDate: d("2025-08-14"),
      rate: nbp,
    });
    expect(fixed(view.withholdingCreditPln, 4)).toBe(fixed(view.taxDuePln, 4));
    expect(fixed(view.topUpPln)).toBe("0.00");
  });

  test("PLN dividends need no rate; a foreign one needs a USD→PLN rate", () => {
    const pln = dividendTaxView({
      gross: money("500", "PLN"),
      withholdingTax: money("95", "PLN"),
      taxDate: d("2025-08-07"),
    });
    expect(fixed(pln.topUpPln)).toBe("0.00");
    expect(codeOf(() => dividendTaxView({ gross, taxDate: d("2025-08-14") }))).toBe(
      "invalid_fx_rate",
    );
    const eur = fxRate({
      base: "EUR",
      quote: "PLN",
      rate: "4.2",
      date: "2025-08-13",
      source: "nbp",
    });
    expect(codeOf(() => dividendTaxView({ gross, taxDate: d("2025-08-14"), rate: eur }))).toBe(
      "invalid_fx_rate",
    );
  });

  test("ledger records the dividend in both views and credits the cash", () => {
    const dividend = {
      id: "DIV",
      accountId: "xtb",
      type: "DIVIDEND",
      tradeDate: d("2025-08-14"),
      instrumentId: "KO",
      amount: money("77.81", "PLN"),
      gross,
      withholdingTax: wht,
    };
    const ledger = buildLedger({
      accounts,
      transactions: [dividend],
      taxRates: createFxRateTable([nbp]),
    });
    const [record] = ledger.dividends;
    expect(record).toMatchObject({
      transactionId: "DIV",
      instrumentId: "KO",
      paymentDate: "2025-08-14",
      taxStatus: "computed",
    });
    expect(fixed(record.net, 4)).toBe(readDecimalText(G.net_usd));
    expect(fixed(record.credited)).toBe(readDecimalText(G.credited_pln_economic));
    expect(rounded(record.tax.topUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
    expect(ledger.cash.map((c) => [c.accountId, fixed(c.balance)])).toEqual([["xtb", "77.81"]]);

    const noRate = buildLedger({ accounts, transactions: [dividend] });
    expect(noRate.dividends[0]).toMatchObject({ taxStatus: "missing_data", tax: null });
    expect(noRate.issues).toEqual([
      { code: "missing_tax_rate", transactionId: "DIV", currency: "USD", date: "2025-08-14" },
    ]);
    const onIkze = buildLedger({ accounts, transactions: [{ ...dividend, accountId: "ikze" }] });
    expect(onIkze.dividends[0]).toMatchObject({ taxStatus: "not_applicable", tax: null });
    const noWht = buildLedger({
      accounts,
      transactions: [{ ...dividend, withholdingTax: undefined }],
      taxRates: createFxRateTable([nbp]),
    });
    expect(fixed(noWht.dividends[0].withholdingTax)).toBe("0.00");
  });
});

describe("cash per account and currency, positions", () => {
  const transactions = [
    cash("D1", "DEPOSIT", "2025-01-02", "10000"),
    trade("B1", "BUY", "2025-01-03", "10", "100", "EUR", "-4300.00"),
    trade("B2", "BUY", "2025-02-03", "5", "110", "EUR", "-2365.00", { fee: money("5", "PLN") }),
    trade("S1", "SELL", "2025-03-03", "3", "120", "EUR", "1540.00"),
    cash("FX", "FX_CONVERSION", "2025-03-04", "-1000", "PLN", {
      counterAmount: money("232.50", "EUR"),
    }),
    cash("I1", "INTEREST", "2025-03-31", "3.21"),
    cash("T1", "TAX", "2025-03-31", "-0.61"),
    cash("F1", "FEE", "2025-03-31", "-10"),
    cash("A1", "ADJUSTMENT", "2025-04-01", "-12.34", "PLN", { category: "cfd_pl" }),
    cash("W1", "WITHDRAWAL", "2025-04-02", "-500"),
    cash("CO", "CASH_TRANSFER_OUT", "2025-04-03", "-100"),
    cash("CI", "CASH_TRANSFER_IN", "2025-04-04", "50", "EUR"),
  ];
  const ledger = buildLedger({ accounts, transactions });

  test("cash is the sum of signed amounts per currency; FX conversion moves both legs", () => {
    expect(ledger.cash.map((c) => [c.accountId, c.balance.currency, fixed(c.balance)])).toEqual([
      ["xtb", "EUR", "282.50"],
      ["xtb", "PLN", "3255.26"],
    ]);
  });

  test("positions aggregate open lots in FIFO order", () => {
    expect(ledger.positions).toHaveLength(1);
    const [p] = ledger.positions;
    expect(p).toMatchObject({ accountId: "xtb", instrumentId: "VWCE" });
    expect(p.quantity.toFixed()).toBe("12");
    // 7/10 of B1 (3010.00) + B2 (2365.00).
    expect(fixed(p.cost)).toBe("5375.00");
    expect(fixed(p.costInstrument)).toBe("1250.00");
    expect(p.lots.map((l) => [l.key, l.quantityRemaining.toFixed()])).toEqual([
      ["B1", "7"],
      ["B2", "5"],
    ]);
    // No NBP table supplied: the EUR tax cost is unknown and reported as an issue.
    expect(p.taxCost).toBeNull();
    expect(ledger.issues.map((i) => i.transactionId)).toEqual(["B1", "B2", "S1"]);
  });

  test("closed positions disappear; cash-only ledgers have no positions", () => {
    const sellAll = trade("S2", "SELL", "2025-05-05", "12", "100", "EUR", "5100");
    const closed = buildLedger({ accounts, transactions: [...transactions, sellAll] });
    expect(closed.positions).toEqual([]);
    expect(buildLedger({ accounts, transactions: [] }).cash).toEqual([]);
  });

  test("cash operations are validated by type", () => {
    const cases = [
      cash("x", "DEPOSIT", "2025-01-02", "0"),
      cash("x", "DEPOSIT", "2025-01-02", "-1"),
      cash("x", "WITHDRAWAL", "2025-01-02", "1"),
      cash("x", "WITHDRAWAL", "2025-01-02", "0"),
      cash("x", "FX_CONVERSION", "2025-01-02", "-1", "PLN", { counterAmount: money("1", "PLN") }),
      cash("x", "FX_CONVERSION", "2025-01-02", "0", "PLN", { counterAmount: money("1", "EUR") }),
      cash("x", "FX_CONVERSION", "2025-01-02", "-1", "PLN", { counterAmount: money("-1", "EUR") }),
      { ...cash("x", "FEE", "2025-01-02", "1"), amount: { amount: 1, currency: "PLN" } },
      {
        id: "x",
        accountId: "xtb",
        type: "DIVIDEND",
        tradeDate: "2025-01-02",
        instrumentId: "KO",
        amount: money("1", "PLN"),
        gross: money("1", "USD"),
        withholdingTax: money("2", "USD"),
      },
      {
        id: "x",
        accountId: "xtb",
        type: "DIVIDEND",
        tradeDate: "2025-01-02",
        instrumentId: "KO",
        amount: money("1", "PLN"),
        gross: money("1", "USD"),
        withholdingTax: money("0.1", "EUR"),
      },
      {
        id: "x",
        accountId: "xtb",
        type: "SECURITY_TRANSFER_OUT",
        tradeDate: "2025-01-02",
        instrumentId: "KO",
        quantity: toDecimal("0"),
      },
      {
        id: "x",
        accountId: "xtb",
        type: "SECURITY_TRANSFER_OUT",
        tradeDate: "2025-01-02",
        instrumentId: "",
        quantity: quantity("1"),
      },
    ];
    for (const bad of cases) {
      expect(codeOf(() => buildLedger({ accounts, transactions: [bad] }))).toBe(
        "invalid_transaction",
      );
    }
  });
});

describe("valuation (obliczenia-finansowe.md § 5, § 4.1, § 2.3)", () => {
  const rates = createFxRateTable([
    fxRate({ base: "EUR", quote: "PLN", rate: "4.3000", date: "2025-06-27", source: "nbp" }),
    fxRate({ base: "USD", quote: "PLN", rate: "3.9000", date: "2025-06-26", source: "nbp" }),
  ]);
  const transactions = [
    cash("D1", "DEPOSIT", "2025-01-02", "10000"),
    trade("B1", "BUY", "2025-01-03", "10", "100", "EUR", "-4300.00"),
    trade("B2", "BUY", "2025-01-03", "2", "50", "PLN", "-100.00", { instrumentId: "PKO" }),
    cash("FX", "FX_CONVERSION", "2025-03-04", "-430", "PLN", {
      counterAmount: money("100", "EUR"),
    }),
    { ...cash("U1", "DEPOSIT", "2025-01-02", "1000", "USD"), accountId: "usd" },
    {
      ...trade("U2", "BUY", "2025-01-03", "4", "200", "EUR", "-800", { instrumentId: "SAP" }),
      accountId: "usd",
      amount: money("-860", "USD"),
    },
  ];
  const ledger = buildLedger({ accounts, transactions });
  const quotes = [
    { instrumentId: "VWCE", price: price("110", "EUR"), asOf: "2025-06-27T15:30:00Z" },
    { instrumentId: "PKO", price: price("55", "PLN"), asOf: "2025-06-27T15:00:00Z" },
    { instrumentId: "SAP", price: price("210", "EUR"), asOf: "2025-06-27T15:35:00Z" },
  ];
  const valuation = valuePortfolio({
    accounts,
    positions: ledger.positions,
    cash: ledger.cash,
    quotes,
    fxRates: rates,
    date: d("2025-06-28"),
  });

  test("positions: value q·price·rate, unrealized P/L and ratio", () => {
    const xtb = valuation.accounts.find((a) => a.accountId === "xtb");
    const vwce = xtb.positions.find((p) => p.instrumentId === "VWCE");
    expect(fixed(vwce.marketValue)).toBe("4730.00");
    expect(fixed(vwce.unrealizedPl)).toBe("430.00");
    expect(vwce.unrealizedRatio).toBeCloseTo(0.1, 12);
    expect(vwce.fxRate.rate.toFixed()).toBe("4.3");
    expect(vwce.priceAsOf).toBe("2025-06-27T15:30:00Z");
    const pko = xtb.positions.find((p) => p.instrumentId === "PKO");
    expect(fixed(pko.marketValue)).toBe("110.00");
  });

  test("account value = positions + cash converted to the account currency", () => {
    const xtb = valuation.accounts.find((a) => a.accountId === "xtb");
    // PLN cash 5170 + EUR 100 × 4.30.
    expect(fixed(xtb.cash)).toBe("5600.00");
    expect(fixed(xtb.total)).toBe("10440.00");
    expect(fixed(xtb.totalReporting)).toBe("10440.00");
    const usd = valuation.accounts.find((a) => a.accountId === "usd");
    // 4 × 210 EUR at EUR→USD 4.30 / 3.90, plus 140 USD cash; then × 3.90 into PLN.
    expect(fixed(usd.marketValue, 6)).toBe(toDecimal("840").times("4.3").div("3.9").toFixed(6));
    expect(fixed(usd.totalReporting, 6)).toBe(
      toDecimal("840").times("4.3").div("3.9").plus("140").times("3.9").toFixed(6),
    );
    expect(usd.fxRate.date).toBe("2025-06-26");
  });

  test("portfolio total, as-of of the oldest price and FX table, completeness", () => {
    expect(valuation.currency).toBe("PLN");
    expect(rounded(valuation.total)).toBe("14598.00");
    expect(valuation.asOf).toBe("2025-06-27T15:00:00Z");
    expect(valuation.fxAsOf).toBe("2025-06-26");
    expect(valuation.isComplete).toBe(true);
    expect(valuation.gaps).toEqual([]);
  });

  test("missing price or FX rate is a gap, never a silent zero", () => {
    const partial = valuePortfolio({
      accounts,
      positions: ledger.positions,
      cash: ledger.cash,
      quotes: quotes.filter((q) => q.instrumentId !== "PKO"),
      fxRates: createFxRateTable([rates.onOrBefore("EUR", "PLN", "2025-06-28")]),
      date: d("2025-06-28"),
    });
    expect(partial.isComplete).toBe(false);
    expect(partial.gaps).toContainEqual({ kind: "price", accountId: "xtb", instrumentId: "PKO" });
    expect(partial.gaps).toContainEqual({
      kind: "fx",
      accountId: "usd",
      base: "EUR",
      quote: "USD",
    });
    expect(partial.gaps).toContainEqual({
      kind: "fx",
      accountId: "usd",
      base: "USD",
      quote: "PLN",
    });
    const pko = partial.accounts[0].positions.find((p) => p.instrumentId === "PKO");
    expect(pko).toMatchObject({
      price: null,
      marketValue: null,
      unrealizedPl: null,
      unrealizedRatio: null,
    });
    expect(partial.accounts.find((a) => a.accountId === "usd").totalReporting).toBeNull();
    expect(rounded(partial.total)).toBe("10330.00");
  });

  test("duplicate quotes are rejected", () => {
    expect(
      codeOf(() =>
        valuePortfolio({
          accounts,
          positions: [],
          cash: [],
          quotes: [quotes[0], quotes[0]],
          fxRates: rates,
          date: d("2025-06-28"),
        }),
      ),
    ).toBe("invalid_price");
  });

  test("unrealized ratio is null for a zero-cost position", () => {
    const gift = trade("G1", "BUY", "2025-01-03", "1", "0", "PLN", "0", { instrumentId: "PKO" });
    const l = buildLedger({ accounts, transactions: [gift] });
    const v = valuePortfolio({
      accounts,
      positions: l.positions,
      cash: l.cash,
      quotes,
      fxRates: rates,
      date: d("2025-06-28"),
    });
    expect(v.accounts[0].positions[0].unrealizedRatio).toBeNull();
    expect(v.fxAsOf).toBeNull();
  });
});

describe("vector F — day result (obliczenia-finansowe.md § 5.1)", () => {
  test("Δ = V(t) − V(D−1) − F; percent relative to V(D−1)", () => {
    const result = dayChange({
      valueNow: money(readDecimalText(F.value_now), "PLN"),
      valuePrevClose: money(readDecimalText(F.value_prev_close), "PLN"),
      externalFlows: money(readDecimalText(F.net_flows_today), "PLN"),
    });
    expect(fixed(result.change)).toBe(readDecimalText(F.day_change_pln));
    expect(`${toDecimal(String(result.ratio)).times(100).toFixed(2)}%`).toBe(F.day_change_pct);
  });

  test("no ratio without a positive previous value", () => {
    const first = dayChange({
      valueNow: money("1000", "PLN"),
      valuePrevClose: money("0", "PLN"),
      externalFlows: money("1000", "PLN"),
    });
    expect(fixed(first.change)).toBe("0.00");
    expect(first.ratio).toBeNull();
    expect(
      codeOf(() =>
        dayChange({
          valueNow: money("1", "PLN"),
          valuePrevClose: money("1", "EUR"),
          externalFlows: money("0", "PLN"),
        }),
      ),
    ).toBe("currency_mismatch");
  });
});

describe("external flows (obliczenia-finansowe.md § 0.4, § 1)", () => {
  const transactions = [
    cash("D1", "DEPOSIT", "2025-01-02", "1000"),
    cash("W1", "WITHDRAWAL", "2025-01-05", "-200"),
    cash("CO", "CASH_TRANSFER_OUT", "2025-01-03", "-300"),
    cash("I1", "INTEREST", "2025-01-04", "1"),
    {
      id: "SO",
      accountId: "xtb",
      type: "SECURITY_TRANSFER_OUT",
      tradeDate: d("2025-01-06"),
      instrumentId: "KO",
      quantity: quantity("1"),
    },
  ];

  test("portfolio level: only deposits and withdrawals, in date order", () => {
    const flows = externalFlows(transactions, { level: "portfolio" });
    expect(flows.map((f) => [f.transactionId, f.date, fixed(f.amount)])).toEqual([
      ["D1", "2025-01-02", "1000.00"],
      ["W1", "2025-01-05", "-200.00"],
    ]);
  });

  test("account level adds cash transfers and, when valued, security transfers", () => {
    const flows = externalFlows(transactions, {
      level: "account",
      securityTransferValue: (tx) => (tx.id === "SO" ? money("450", "PLN") : undefined),
    });
    expect(flows.map((f) => [f.transactionId, fixed(f.amount)])).toEqual([
      ["D1", "1000.00"],
      ["CO", "-300.00"],
      ["W1", "-200.00"],
      ["SO", "-450.00"],
    ]);
    expect(externalFlows(transactions, { level: "account" }).map((f) => f.transactionId)).toEqual([
      "D1",
      "CO",
      "W1",
    ]);
  });
});
