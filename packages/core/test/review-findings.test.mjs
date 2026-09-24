import {
  beta,
  buildAverageCostView,
  buildLedger,
  correlation,
  createFxRateTable,
  dayChange,
  drawdowns,
  externalFlows,
  fxRate,
  historicalCvar,
  investorCashflows,
  isCoreError,
  isoDate,
  money,
  parametricVar,
  periodReturn,
  price,
  quantity,
  rebalance,
  riskMetrics,
  roundMoney,
  settlementRegionForMic,
  sharpeRatio,
  timeWeightedReturn,
  toDecimal,
  trailingDividends,
  twrIndex,
  validateTransaction,
  valuePortfolio,
  xirr,
} from "@oliginvest/core";
import { loadTestVectors, readStatistic } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

/**
 * Defects found in the independent review of packages/core (docs/08-plan/m1-core-przeglad.md).
 * Every test fails on the reviewed code and is skipped so that the build stays green. Run them all
 * from the repository root with
 * `CORE_REVIEW=1 pnpm --filter @oliginvest/core exec vitest run test/review-findings.test.mjs`;
 * when a finding is fixed, turn its `failsToday(...)` into `test(...)`.
 */
const failsToday = test.skipIf(process.env.CORE_REVIEW !== "1");

const d = isoDate;
const pln = (v) => money(v, "PLN");
const usd = (v) => money(v, "USD");
const sum = (list) => list.reduce((total, v) => total.plus(v), toDecimal("0"));

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

/** Result of a call, or the CoreError it threw (other errors propagate). */
function attempt(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    if (!isCoreError(error)) throw error;
    return { error };
  }
}

const regular = [{ id: "a", currency: "PLN", accountType: "regular" }];

function trade(id, type, tradeDate, qty, px, amount, extra = {}) {
  return {
    id,
    accountId: "a",
    type,
    tradeDate: d(tradeDate),
    settleDate: d(tradeDate),
    instrumentId: "X",
    quantity: quantity(qty),
    price: price(px, "PLN"),
    amount: pln(amount),
    ...extra,
  };
}

describe("ledger, transfers and the tax view", () => {
  const accounts = [
    { id: "mbank", currency: "PLN", accountType: "regular" },
    { id: "xtb-usd", currency: "USD", accountType: "regular" },
  ];
  // AAPL bought on a PLN account (economic cost 8040 PLN), then moved to a USD account.
  const buyOnPln = {
    id: "B1",
    accountId: "mbank",
    type: "BUY",
    tradeDate: d("2025-01-10"),
    settleDate: d("2025-01-13"),
    instrumentId: "AAPL",
    quantity: quantity("10"),
    price: price("200", "USD"),
    amount: pln("-8040"),
    fxFee: pln("40"),
  };
  const out = {
    id: "OUT",
    accountId: "mbank",
    type: "SECURITY_TRANSFER_OUT",
    tradeDate: d("2025-02-03"),
    instrumentId: "AAPL",
    quantity: quantity("10"),
  };
  const inbound = {
    id: "IN",
    accountId: "xtb-usd",
    type: "SECURITY_TRANSFER_IN",
    tradeDate: d("2025-02-03"),
    sequence: 1,
    instrumentId: "AAPL",
    quantity: quantity("10"),
    relatedTransactionId: "OUT",
  };
  const buyOnUsd = (id, date) => ({
    id,
    accountId: "xtb-usd",
    type: "BUY",
    tradeDate: d(date),
    settleDate: d(date),
    instrumentId: "AAPL",
    quantity: quantity("1"),
    price: price("205", "USD"),
    amount: usd("-205"),
  });

  test("C-01 a sale after a transfer to a USD account does not relabel the PLN cost", () => {
    const sell = {
      ...buyOnUsd("S1", "2025-03-03"),
      type: "SELL",
      quantity: quantity("10"),
      price: price("210", "USD"),
      amount: usd("2100"),
    };
    const outcome = attempt(() =>
      buildLedger({ accounts, transactions: [buyOnPln, out, inbound, sell] }),
    );
    if (outcome.error) {
      // Rejecting the transfer is an acceptable fix, provided it names the operation.
      expect(outcome.error.details.transactionId).toBe("IN");
      return;
    }
    const [sale] = outcome.value.sales;
    // Today: costEconomic "8040 USD" (the PLN amount with a USD label), P/L "−5940 USD".
    expect(sale.costEconomic?.amount.toFixed()).not.toBe("8040");
  });

  test("C-01 a position on a USD account never carries a PLN cost", () => {
    const outcome = attempt(() =>
      buildLedger({ accounts, transactions: [buyOnPln, out, inbound] }),
    );
    if (outcome.error) {
      expect(outcome.error.details.transactionId).toBe("IN");
      return;
    }
    const [position] = outcome.value.positions;
    // Today: cost 8040 PLN on the USD account; valuePortfolio then throws currency_mismatch.
    expect(position.cost === null || position.cost.currency === "USD").toBe(true);
  });

  test("C-01 lots in two currencies in one position name the operation instead of crashing", () => {
    const outcome = attempt(() =>
      buildLedger({
        accounts,
        transactions: [buyOnPln, buyOnUsd("B2", "2025-01-20"), out, inbound],
      }),
    );
    // Today: a bare currency_mismatch from sumMoney breaks the whole ledger (every account).
    if (outcome.error) expect(outcome.error.details.transactionId).toBe("IN");
  });

  test("C-01 the average-cost pool never adds amounts in different currencies", () => {
    const outcome = attempt(() =>
      buildAverageCostView({
        accounts,
        transactions: [buyOnPln, out, inbound, buyOnUsd("B3", "2025-02-10")],
      }),
    );
    if (outcome.error) {
      expect(outcome.error.details.transactionId).toBeDefined();
      return;
    }
    // Today: 8040 PLN + 205 USD reported as a pool cost of "8245 PLN".
    expect(outcome.value.positions[0].cost?.amount.toFixed()).not.toBe("8245");
  });

  test("C-01 (decision) the cost moves to the target currency at the NBP rate of the transfer day", () => {
    const taxRates = createFxRateTable([
      fxRate({ base: "USD", quote: "PLN", rate: "4.00", date: "2025-02-03", source: "nbp" }),
      fxRate({ base: "USD", quote: "PLN", rate: "3.95", date: "2025-01-10", source: "nbp" }),
    ]);
    const sell = {
      ...buyOnUsd("S1", "2025-03-03"),
      type: "SELL",
      quantity: quantity("11"),
      price: price("210", "USD"),
      amount: usd("2310"),
    };
    const ledger = buildLedger({
      accounts,
      transactions: [buyOnPln, out, inbound, buyOnUsd("B2", "2025-02-10"), sell],
      taxRates,
    });
    const moved = ledger.lots.find((lot) => lot.key === "IN/B1");
    expect(moved.cost.currency).toBe("USD");
    expect(moved.cost.amount.toFixed()).toBe("2010");
    expect(moved.transferRate.rate.toFixed()).toBe(toDecimal("1").div("4").toFixed());
    // The tax-view cost in PLN is unchanged (NBP D-1 of the original settlement).
    expect(moved.taxCost.amount.toFixed()).toBe("7900");
    const [sale] = ledger.sales;
    expect(sale.costEconomic.amount.toFixed()).toBe("2215");
    expect(sale.realizedPlEconomic.amount.toFixed()).toBe("95");
    const view = buildAverageCostView({
      accounts,
      transactions: [buyOnPln, out, inbound, buyOnUsd("B3", "2025-02-10")],
      taxRates,
    });
    expect(view.positions[0].cost.amount.toFixed()).toBe("2215");
    const noRate = buildLedger({ accounts, transactions: [buyOnPln, out, inbound] });
    expect(noRate.issues).toContainEqual({
      code: "missing_transfer_rate",
      transactionId: "IN",
      currency: "PLN",
      date: "2025-02-03",
    });
    expect(noRate.positions[0]).toMatchObject({ costKnown: false, cost: null });
  });

  test("C-03 a 1:3 reverse split leaves exactly 10 of 30 units, which can be sold", () => {
    const buy = trade("B", "BUY", "2025-01-02", "30", "1", "-30");
    // Owner decision 2026-09-24: a split is an integer pair (3 old units → 1 new unit).
    const split = {
      id: "SP",
      accountId: "a",
      type: "SPLIT",
      tradeDate: d("2025-02-03"),
      instrumentId: "X",
      ratioFrom: 3,
      ratioTo: 1,
    };
    const sell = trade("S", "SELL", "2025-03-03", "10", "3.30", "33");
    const held = buildLedger({ accounts: regular, transactions: [buy, split] });
    // Today: 9.999999999999999999999999999999999 units.
    expect(held.positions[0].quantity.toFixed()).toBe("10");
    // Today: short_position — the whole recompute of the account fails.
    const sold = buildLedger({ accounts: regular, transactions: [buy, split, sell] });
    expect(sold.sales[0].realizedPlEconomic.amount.toFixed()).toBe("3");
  });

  test("C-03 (decision) the fraction left by a reverse split is settled as cash in lieu", () => {
    const buy = trade("B", "BUY", "2025-01-02", "31", "1", "-31");
    const split = {
      id: "SP",
      accountId: "a",
      type: "SPLIT",
      tradeDate: d("2025-02-03"),
      settleDate: d("2025-02-03"),
      instrumentId: "X",
      ratioFrom: 3,
      ratioTo: 1,
      cashInLieu: pln("1.20"),
    };
    const ledger = buildLedger({ accounts: regular, transactions: [buy, split] });
    expect(ledger.positions[0].quantity.toFixed()).toBe("10");
    expect(ledger.positions[0].cost.amount.toFixed()).toBe("30");
    const [sale] = ledger.sales;
    expect(sale.transactionId).toBe("SP");
    expect(sale.realizedPlEconomic.amount.toFixed()).toBe("0.2");
    expect(ledger.cash[0].balance.amount.toFixed()).toBe("-29.8");
    const view = buildAverageCostView({ accounts: regular, transactions: [buy, split] });
    expect(view.positions[0].quantity.toFixed()).toBe("10");
    expect(view.sales[0].realizedPl.amount.toFixed()).toBe("0.2");
    const noLieu = buildLedger({
      accounts: regular,
      transactions: [buy, { ...split, cashInLieu: undefined }],
    });
    expect(noLieu.positions[0].quantity.toFixed(6)).toBe("10.333333");
    const bad = { ...split, ratioFrom: 1.5 };
    expect(codeOf(() => buildLedger({ accounts: regular, transactions: [buy, bad] }))).toBe(
      "invalid_transaction",
    );
  });

  test("C-04 an FTT stored as a TAX linked to the purchase is part of the lot cost", () => {
    const buy = trade("B", "BUY", "2025-01-02", "100", "10", "-1000");
    // formaty-importu.md § 2.2: `Tax IFTT` → TAX(ftt) linked to the purchase; OBL § 4.4: FTT
    // assigned to a purchase is part of its acquisition cost.
    const ftt = {
      id: "FTT",
      accountId: "a",
      type: "TAX",
      tradeDate: d("2025-01-02"),
      amount: pln("-1"),
      category: "ftt",
      relatedTransactionId: "B",
    };
    const [lot] = buildLedger({ accounts: regular, transactions: [buy, ftt] }).lots;
    // Today both costs stay at 1000: the link is ignored and the TAX is only a cash movement.
    expect(lot.cost.amount.toFixed()).toBe("1001");
    expect(lot.taxCost.amount.toFixed()).toBe("1001");
  });

  test("C-04 a withholding tax stored as a TAX linked to the dividend is credited", () => {
    const accounts = [{ id: "u", currency: "USD", accountType: "regular" }];
    // XTB credits the gross dividend and books the withholding tax as a separate row; when the
    // import cannot pair them, it stores a TAX linked to the dividend (formaty-importu.md § 2.2).
    const dividend = {
      id: "DIV",
      accountId: "u",
      type: "DIVIDEND",
      tradeDate: d("2025-08-14"),
      instrumentId: "KO",
      amount: usd("25.00"),
      gross: usd("25.00"),
    };
    const wht = {
      id: "WHT",
      accountId: "u",
      type: "TAX",
      tradeDate: d("2025-08-14"),
      amount: usd("-3.75"),
      relatedTransactionId: "DIV",
    };
    const taxRates = createFxRateTable([
      fxRate({ base: "USD", quote: "PLN", rate: "3.6900", date: "2025-08-13", source: "nbp" }),
    ]);
    const [record] = buildLedger({ accounts, transactions: [dividend, wht], taxRates }).dividends;
    // Vector G: estimated top-up 3.69 PLN; today 17.53 PLN (withholding tax taken as zero).
    expect(roundMoney(record.tax.topUpPln).amount.toFixed(2)).toBe("3.69");
  });

  test("C-04 a SEC fee stored as a FEE linked to the sale reduces its proceeds in both views", () => {
    const buy = trade("B", "BUY", "2025-01-02", "10", "10", "-100");
    const sell = trade("S", "SELL", "2025-02-03", "10", "12", "120");
    const fee = {
      id: "SEC",
      accountId: "a",
      type: "FEE",
      tradeDate: d("2025-02-03"),
      amount: pln("-0.50"),
      category: "sec_fee",
      relatedTransactionId: "S",
    };
    const ledger = buildLedger({ accounts: regular, transactions: [buy, sell, fee] });
    const [sale] = ledger.sales;
    expect(sale.proceedsEconomic.amount.toFixed()).toBe("119.5");
    expect(sale.realizedPlEconomic.amount.toFixed()).toBe("19.5");
    expect(sale.tax.realizedPlPln.amount.toFixed()).toBe("19.5");
    // Cash is booked once, from the FEE row itself.
    expect(ledger.cash[0].balance.amount.toFixed()).toBe("19.5");
    const view = buildAverageCostView({ accounts: regular, transactions: [buy, sell, fee] });
    expect(view.sales[0].realizedPl.amount.toFixed()).toBe("19.5");
    const foreign = { ...fee, amount: usd("-0.5") };
    expect(
      codeOf(() => buildLedger({ accounts: regular, transactions: [buy, sell, foreign] })),
    ).toBe("invalid_transaction");
  });

  failsToday("C-06 an NBP rate far older than D-1 is not used silently in the tax view", () => {
    const buy = {
      ...trade("B", "BUY", "2025-03-03", "10", "0", "-4000"),
      settleDate: d("2025-03-04"),
      price: price("100", "USD"),
    };
    const taxRates = createFxRateTable([
      fxRate({ base: "USD", quote: "PLN", rate: "4.20", date: "2025-01-31", source: "nbp" }),
    ]);
    const ledger = buildLedger({ accounts: regular, transactions: [buy], taxRates });
    // D-1 of the settlement is Monday 2025-03-03; today the 2025-01-31 rate gives a tax cost of
    // 4200 PLN without any issue, and the rate date is not part of the result.
    expect(ledger.issues.map((issue) => issue.transactionId)).toContain("B");
  });

  failsToday(
    "C-15 the tax view of a lot does not depend on where an unknown-cost lot sits in FIFO",
    () => {
      const known = trade("B9", "BUY", "2024-06-10", "5", "50", "-250");
      const unknown = (date) => ({
        id: "IN",
        accountId: "a",
        type: "SECURITY_TRANSFER_IN",
        tradeDate: d(date),
        instrumentId: "X",
        quantity: quantity("10"),
      });
      const sell = trade("S", "SELL", "2024-08-01", "15", "60", "900");
      const taxOfKnownLot = (transactions) =>
        buildLedger({ accounts: regular, transactions })
          .sales[0].consumptions.find((c) => c.lotKey === "B9")
          .tax?.realizedPlPln.amount.toFixed() ?? null;
      // B9 is consumed in full in both orders (P/L 50); today: "50" after it, null before it.
      expect(taxOfKnownLot([unknown("2024-01-02"), known, sell])).toBe(
        taxOfKnownLot([known, unknown("2024-07-01"), sell]),
      );
    },
  );

  test("C-17 executedAt must carry an explicit offset", () => {
    const deposit = {
      id: "x",
      accountId: "a",
      type: "DEPOSIT",
      tradeDate: d("2025-01-02"),
      amount: pln("1"),
    };
    // Today all three are accepted and read in the server's time zone by Date.parse.
    for (const text of ["2025-01-02T09:30:00", "2025-01-02", "January 2, 2025 09:30"]) {
      expect(codeOf(() => validateTransaction({ ...deposit, executedAt: text }, regular[0]))).toBe(
        "invalid_transaction",
      );
    }
  });

  test("C-18 a declared acquisition date cannot follow the transfer date", () => {
    const inbound = {
      id: "IN",
      accountId: "a",
      type: "SECURITY_TRANSFER_IN",
      tradeDate: d("2024-01-02"),
      instrumentId: "X",
      quantity: quantity("10"),
      acquisitionCost: pln("100"),
      acquiredOn: d("2030-01-01"),
    };
    expect(codeOf(() => buildLedger({ accounts: regular, transactions: [inbound] }))).toBe(
      "invalid_transaction",
    );
  });

  test("C-19 a sale whose commission exceeds its value is accepted (§ 1)", () => {
    const buy = trade("B", "BUY", "2025-01-02", "1", "0.50", "-5.50", { fee: pln("5") });
    const sell = trade("S", "SELL", "2025-02-03", "1", "0.40", "-4.60", { fee: pln("5") });
    // Today: invalid_transaction ("Invalid sign of amount for SELL").
    const ledger = buildLedger({ accounts: regular, transactions: [buy, sell] });
    expect(ledger.sales[0].realizedPlEconomic.amount.toFixed(2)).toBe("-10.10");
  });

  failsToday("C-20 the dividend payment date is settle_date when given (§ 4.3)", () => {
    const dividend = {
      id: "D",
      accountId: "a",
      type: "DIVIDEND",
      tradeDate: d("2024-09-27"),
      settleDate: d("2024-10-02"),
      instrumentId: "X",
      amount: pln("10"),
      gross: pln("10"),
    };
    const ledger = buildLedger({ accounts: regular, transactions: [dividend] });
    // Today: tax date 2024-10-02, but paymentDate 2024-09-27 drives the 12-month window.
    expect(ledger.dividends[0].paymentDate).toBe("2024-10-02");
    expect(trailingDividends(ledger.dividends, { asOf: d("2025-09-30") })).toHaveLength(1);
  });

  failsToday("C-21 settlement regions cover the US and EU venues of § 2.2", () => {
    // Today only XNYS, XNAS, XWAR and XETR are mapped; most US ETFs list on NYSE Arca (ARCX).
    for (const mic of ["ARCX", "BATS", "XASE"]) expect(settlementRegionForMic(mic)).toBe("US");
    for (const mic of ["XAMS", "XPAR", "XMIL", "XFRA"])
      expect(settlementRegionForMic(mic)).toBe("EU");
  });

  failsToday(
    "C-26 a lot moved from IKE and sold on a regular account explains the missing tax view",
    () => {
      const accounts = [
        { id: "ike", currency: "PLN", accountType: "ike" },
        { id: "a", currency: "PLN", accountType: "regular" },
      ];
      const buy = { ...trade("B", "BUY", "2024-01-02", "10", "10", "-100"), accountId: "ike" };
      const move = [
        {
          id: "OUT",
          accountId: "ike",
          type: "SECURITY_TRANSFER_OUT",
          tradeDate: d("2024-02-01"),
          instrumentId: "X",
          quantity: quantity("10"),
        },
        {
          id: "IN",
          accountId: "a",
          type: "SECURITY_TRANSFER_IN",
          tradeDate: d("2024-02-01"),
          sequence: 1,
          instrumentId: "X",
          quantity: quantity("10"),
          relatedTransactionId: "OUT",
        },
      ];
      const sell = trade("S", "SELL", "2024-03-01", "10", "12", "120");
      const ledger = buildLedger({ accounts, transactions: [buy, ...move, sell] });
      expect(ledger.sales[0].taxStatus).toBe("missing_data");
      // Today: no issue at all, so the UI cannot say why the tax view is empty.
      expect(ledger.issues.length).toBeGreaterThan(0);
    },
  );
});

describe("valuation, flows and returns", () => {
  failsToday(
    "C-02 a transfer from outside the tracked accounts is an external flow of the portfolio",
    () => {
      const transactions = [
        {
          id: "D1",
          accountId: "a",
          type: "DEPOSIT",
          tradeDate: d("2025-01-02"),
          amount: pln("1000"),
        },
        {
          id: "IN",
          accountId: "a",
          type: "SECURITY_TRANSFER_IN",
          tradeDate: d("2025-01-03"),
          instrumentId: "X",
          quantity: quantity("10"),
          acquisitionCost: pln("900"),
          acquiredOn: d("2020-01-02"),
        },
      ];
      const flows = externalFlows(transactions, {
        level: "portfolio",
        securityTransferValue: () => pln("1000"),
      });
      // Today: ["D1"] — shares worth 1000 PLN enter the portfolio without a flow.
      expect(flows.map((flow) => flow.transactionId)).toEqual(["D1", "IN"]);
      const flowOn = (date) => flows.find((flow) => flow.date === date)?.amount;
      const result = timeWeightedReturn([
        { date: d("2025-01-02"), value: pln("1000"), flow: flowOn("2025-01-02") },
        { date: d("2025-01-03"), value: pln("2000"), flow: flowOn("2025-01-03") },
      ]);
      // Today: +100 % TWR for a portfolio whose prices did not move.
      expect(result.twr).toBeCloseTo(0, 12);
    },
  );

  failsToday("C-05 a value below zero does not flip the sign of the TWR index", () => {
    const points = [
      { date: d("2025-01-01"), value: pln("1000"), flow: pln("1000") },
      { date: d("2025-01-02"), value: pln("5"), flow: pln("-990") },
      // A fee larger than the residual cash: V < 0 while V(d−1) + F > 0.
      { date: d("2025-01-03"), value: pln("-5") },
      { date: d("2025-01-06"), value: pln("1000"), flow: pln("1005") },
      { date: d("2025-01-07"), value: pln("1100") },
    ];
    const index = twrIndex(points);
    // Today: index 1, 0.5, −0.5, −0.5, −0.55 — TWR −155 %, and a +10 % day lowers the index.
    expect(index.every((point) => point.index.isPositive())).toBe(true);
    expect(timeWeightedReturn(points).twr).toBeGreaterThanOrEqual(-1);
    expect(codeOf(() => drawdowns(index.map((point) => point.index)))).toBe("no-error");
  });

  failsToday("C-05 a value of zero does not freeze the TWR index for good", () => {
    const index = twrIndex([
      { date: d("2025-01-01"), value: pln("1000"), flow: pln("1000") },
      // The last 1 PLN is taken by a fee: V = 0 while V(d−1) + F = 1.
      { date: d("2025-01-02"), value: pln("0"), flow: pln("-999") },
      { date: d("2025-01-06"), value: pln("1000"), flow: pln("1000") },
      { date: d("2025-01-07"), value: pln("1100") },
    ]);
    // Today: the index stays 0 from 2025-01-02 on and every later period return is NaN.
    expect(periodReturn(index, d("2025-01-06"), d("2025-01-07"))).toBeCloseTo(0.1, 12);
  });

  failsToday("C-13 (document) the day's percent uses the TWR base V(D−1) + F", () => {
    const result = dayChange({
      valueNow: pln("10150"),
      valuePrevClose: pln("100"),
      externalFlows: pln("10000"),
    });
    // OBL § 5.1 divides by V(D−1): +50 % on the day of a 10 000 PLN deposit that earned 50 PLN.
    expect(result.ratio).toBeCloseTo(50 / 10100, 12);
  });

  failsToday(
    "C-16 a zero balance in a currency without a rate does not make the valuation incomplete",
    () => {
      const ledger = buildLedger({
        accounts: regular,
        transactions: [
          {
            id: "D",
            accountId: "a",
            type: "DEPOSIT",
            tradeDate: d("2025-01-02"),
            amount: pln("1000"),
          },
          {
            id: "FX1",
            accountId: "a",
            type: "FX_CONVERSION",
            tradeDate: d("2025-01-03"),
            amount: pln("-430"),
            counterAmount: money("100", "EUR"),
          },
          {
            id: "FX2",
            accountId: "a",
            type: "FX_CONVERSION",
            tradeDate: d("2025-01-04"),
            amount: money("-100", "EUR"),
            counterAmount: pln("428"),
          },
        ],
      });
      const valuation = valuePortfolio({
        accounts: regular,
        positions: ledger.positions,
        cash: ledger.cash,
        quotes: [],
        fxRates: createFxRateTable([]),
        date: d("2025-06-30"),
      });
      // Today: EUR 0 without an EUR rate → isComplete false and an "fx" gap for a known value.
      expect(valuation.isComplete).toBe(true);
      expect(valuation.gaps).toEqual([]);
    },
  );

  failsToday("C-25 investor cash flows reject flows outside the period", () => {
    // Today the 2024 flow becomes t0, so the start value is no longer at the start.
    expect(
      codeOf(() =>
        investorCashflows({
          start: { date: d("2025-01-01"), value: pln("1000") },
          flows: [{ date: d("2024-06-01"), amount: pln("500") }],
          end: { date: d("2025-12-31"), value: pln("1600") },
        }),
      ),
    ).toBe("invalid_series");
  });

  failsToday("C-28 XIRR for ten years of monthly flows fits the request budget", () => {
    const flows = Array.from({ length: 120 }, (_, i) => ({
      date: d(`${2015 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`),
      amount: pln("-1000"),
    }));
    flows.push({ date: d("2025-01-15"), amount: pln("190000") });
    xirr(flows);
    const started = performance.now();
    expect(xirr(flows).status).toBe("ok");
    // Today about 200 ms per call (Node 24, 2.8 GHz Xeon); a performance screen needs 8 periods.
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("risk metrics and drawdowns", () => {
  const D = loadTestVectors().D_risk;
  const returns = D.returns.map(readStatistic);

  failsToday("C-07 constant series give null ratios despite floating-point noise", () => {
    // Today: 8.9e16, 3.9e16, 0.2 and 1.1e-16 — the `=== 0` checks miss a rounding residue.
    expect(sharpeRatio(Array(20).fill(0.01))).toBeNull();
    expect(sharpeRatio(Array(60).fill(0.0001))).toBeNull();
    const moving = Array.from({ length: 20 }, (_, i) => (i % 3) * 0.001);
    const flat = Array(20).fill(0.001);
    expect(beta(moving, flat)).toBeNull();
    expect(correlation(moving, flat)).toBeNull();
  });

  failsToday("C-08 the parametric VaR follows the confidence reported in the assumptions", () => {
    const summary = riskMetrics(returns, { confidence: 0.99 });
    expect(summary.assumptions.confidence).toBe(0.99);
    // z(0.99) = 2.3263; today the 95 % quantile 1.6449 is used whatever the confidence.
    expect(summary.varParametric).toBeCloseTo(parametricVar(returns, 2.3263), 4);
  });

  failsToday("C-22 with equal highs the drawdown starts at the last one, as in empyrical", () => {
    const result = drawdowns(["100", "110", "110", "90"].map((v) => toDecimal(v)));
    // Today: peak index 1, so the duration includes the flat day.
    expect(result.peakIndex).toBe(2);
  });

  failsToday("C-23 (document) historical CVaR with ties at the cut-off matches empyrical", () => {
    const tied = [-0.05, -0.04, -0.03, -0.02, -0.01, -0.01, -0.01, ...Array(93).fill(0.001)];
    // empyrical: mean of the int((n − 1)·0.05) + 1 = 5 lowest → 0.03; today 0.0242857 (7 values).
    expect(Math.abs(historicalCvar(tied) - 0.03)).toBeLessThanOrEqual(1e-6);
  });

  failsToday("C-24 one observation is reported as „mało danych”, not as an exception", () => {
    // Today: invalid_series ("At least 2 observations are required").
    expect(riskMetrics([0.01]).insufficientData).toBe(true);
  });
});

describe("rebalancing", () => {
  const whole = (instrumentId, value, unitPrice) => ({
    instrumentId,
    value: pln(value),
    unitPrice: pln(unitPrice),
  });
  const halves = [
    { instrumentId: "A", weight: "0.5" },
    { instrumentId: "B", weight: "0.5" },
  ];

  failsToday("C-09 buy_only invests only the new cash, not the cash already on the account", () => {
    const result = rebalance({
      holdings: [whole("A", "1000", "100"), whole("B", "1000", "100")],
      targets: halves,
      cash: pln("5000"),
      newCash: pln("100"),
      mode: "buy_only",
      taxable: false,
      reconciled: true,
    });
    // Today the leftover loop buys 25 + 25 units (5000 PLN) with 100 PLN of new cash.
    const bought = sum(result.trades.map((t) => t.amount.amount));
    expect(bought.lessThanOrEqualTo("100")).toBe(true);
  });

  failsToday("C-10 leftover cash does not recreate orders below the minimum value", () => {
    const result = rebalance({
      holdings: [whole("A", "0", "100"), whole("B", "0", "100")],
      targets: halves,
      newCash: pln("1000"),
      minOrder: pln("600"),
      mode: "buy_only",
      taxable: false,
      reconciled: true,
    });
    // Today: A 500 and B 500 — dropped by the minimum, then bought back unit by unit.
    for (const t of result.trades)
      expect(t.amount.amount.abs().greaterThanOrEqualTo("600")).toBe(true);
  });

  failsToday("C-11 the estimated tax nets gains and losses of the same calculation", () => {
    const ledger = buildLedger({
      accounts: regular,
      transactions: [
        { ...trade("BA", "BUY", "2024-01-02", "100", "50", "-5000"), instrumentId: "A" },
        { ...trade("BB", "BUY", "2024-01-02", "100", "70", "-7000"), instrumentId: "B" },
      ],
    });
    const lots = (id) => ledger.positions.find((p) => p.instrumentId === id).lots;
    const result = rebalance({
      holdings: [
        { ...whole("A", "6000", "60"), lots: lots("A") },
        { ...whole("B", "6000", "60"), lots: lots("B") },
        whole("C", "0", "10"),
      ],
      targets: [
        { instrumentId: "A", weight: "0" },
        { instrumentId: "B", weight: "0" },
        { instrumentId: "C", weight: "1" },
      ],
      mode: "full",
      taxable: true,
      reconciled: true,
    });
    // A: +1000, B: −1000 in the same tax year → 0; today 190.00 (each loss clamped to zero).
    expect(result.estimatedTax.amount.toFixed(2)).toBe("0.00");
  });

  failsToday("C-12 buy_only with a band does not push an instrument far above its target", () => {
    const targets = { A: 0.52, B: 0.28, C: 0.2 };
    const result = rebalance({
      holdings: [
        { instrumentId: "A", value: pln("5000") },
        { instrumentId: "B", value: pln("2000") },
        { instrumentId: "C", value: pln("3000") },
      ],
      targets: Object.entries(targets).map(([instrumentId, w]) => ({
        instrumentId,
        weight: String(w),
      })),
      newCash: pln("10000"),
      mode: "buy_only",
      taxable: false,
      reconciled: true,
    });
    // Today: A is skipped (50 % vs 52 %) and all new cash goes to B and C — B ends at 49.1 %.
    for (const { instrumentId, weight } of result.weightsAfter) {
      expect(weight, instrumentId).toBeLessThanOrEqual(targets[instrumentId] + 0.05 + 1e-12);
    }
  });

  failsToday("C-14 trimming purchases never leaves negative cash", () => {
    const result = rebalance({
      holdings: [whole("A", "0", "1")],
      targets: [{ instrumentId: "A", weight: "1" }],
      cash: pln("1000000"),
      costRate: "0.02",
      mode: "full",
      taxable: false,
      reconciled: true,
    });
    // Today the loop stops after 10 000 one-unit steps with cashAfter −9800.00.
    expect(result.cashAfter.amount.isNegative()).toBe(false);
  });

  failsToday("C-27 a blocked calculation reports no tax estimate (null), not zero", () => {
    const result = rebalance({
      holdings: [{ instrumentId: "A", value: pln("100") }],
      targets: [{ instrumentId: "A", weight: "1" }],
      mode: "full",
      taxable: true,
      reconciled: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.estimatedTax).toBeNull();
  });
});
