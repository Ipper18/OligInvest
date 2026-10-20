import {
  buildLedger,
  convertMoney,
  createFxRateTable,
  dayChange,
  externalFlows,
  fxRate,
  grossValue,
  isoDate,
  money,
  price,
  quantity,
  sumMoney,
  valuePortfolio,
} from "@oliginvest/core";
import { expect, test } from "vitest";
import { projectDayBreakdown } from "../src/server/day-breakdown.js";

const date = isoDate("2026-10-13"),
  fx = createFxRateTable([]);
const valuation = (positions) => ({
  isComplete: true,
  total: money("1000", "PLN"),
  accounts: [
    {
      fxRate: fx.onOrBefore("PLN", "PLN", date),
      positions: positions.map(([instrumentId, value]) => ({
        instrumentId,
        marketValue: value === null ? null : money(value, "PLN"),
      })),
    },
  ],
});
const tx = (id, type, extra) => ({ id, type, accountId: "a", tradeDate: date, ...extra });

test("ledger → valuations → § 5.1: commissions, transfers, split and cash FX count once before rounding", () => {
  const previousDate = isoDate("2026-10-12");
  const rates = createFxRateTable([
    fxRate({ base: "USD", quote: "PLN", rate: "4", date: previousDate, source: "nbp" }),
    fxRate({ base: "USD", quote: "PLN", rate: "4.1", date, source: "nbp" }),
  ]);
  const accounts = [
    { id: "a", currency: "PLN", accountType: "regular" },
    { id: "b", currency: "PLN", accountType: "regular" },
  ];
  const trade = (id, type, amount, extra = {}) =>
    tx(id, type, {
      instrumentId: "i",
      quantity: quantity("1"),
      price: price("100", "PLN"),
      amount: money(amount, "PLN"),
      ...extra,
    });
  const opening = [
    { ...tx("fund", "DEPOSIT", { amount: money("1000", "PLN") }), tradeDate: previousDate },
    { ...trade("opening", "BUY", "-100"), tradeDate: previousDate },
    { ...tx("usd", "DEPOSIT", { amount: money("100", "USD") }), tradeDate: previousDate },
  ];
  const scenarios = [
    {
      name: "buy",
      transactions: [trade("buy", "BUY", "-102", { fee: money("2", "PLN") })],
      px: "100.006",
      position: "-1.988",
      residual: "10",
    },
    {
      name: "sale to zero",
      transactions: [trade("sell", "SELL", "109", { fee: money("1", "PLN") })],
      px: "100",
      position: "9",
      residual: "10",
    },
    {
      name: "net dividend and separate fee",
      transactions: [
        tx("div", "DIVIDEND", {
          instrumentId: "i",
          amount: money("4", "PLN"),
          gross: money("5", "PLN"),
          withholdingTax: money("1", "PLN"),
        }),
        tx("fee", "FEE", { relatedTransactionId: "div", amount: money("-0.125", "PLN") }),
      ],
      px: "95",
      position: "-1.125",
      residual: "10",
    },
    {
      name: "unassigned fee",
      transactions: [tx("fee", "FEE", { amount: money("-0.125", "PLN") })],
      px: "100",
      position: "0",
      residual: "9.875",
    },
    {
      name: "security in",
      transactions: [
        tx("in", "SECURITY_TRANSFER_IN", { instrumentId: "i", quantity: quantity("1") }),
      ],
      px: "100",
      position: "0",
      residual: "10",
    },
    {
      name: "security out",
      transactions: [
        tx("out", "SECURITY_TRANSFER_OUT", { instrumentId: "i", quantity: quantity("1") }),
      ],
      px: "100",
      position: "0",
      residual: "10",
    },
    {
      name: "paired security and cash transfers",
      transactions: [
        tx("out", "SECURITY_TRANSFER_OUT", { instrumentId: "i", quantity: quantity("1") }),
        tx("in", "SECURITY_TRANSFER_IN", {
          accountId: "b",
          sequence: 1,
          instrumentId: "i",
          quantity: quantity("1"),
          relatedTransactionId: "out",
        }),
        tx("cash-out", "CASH_TRANSFER_OUT", { amount: money("-10", "PLN") }),
        tx("cash-in", "CASH_TRANSFER_IN", {
          accountId: "b",
          amount: money("10", "PLN"),
          relatedTransactionId: "cash-out",
        }),
      ],
      px: "100",
      position: "0",
      residual: "10",
    },
    {
      name: "split",
      transactions: [tx("split", "SPLIT", { instrumentId: "i", ratioFrom: 1, ratioTo: 4 })],
      px: "25",
      position: "0",
      residual: "10",
    },
  ];
  for (const s of scenarios) {
    const transactions = [...opening, ...s.transactions];
    const quotes = [{ instrumentId: "i", price: price(s.px, "PLN"), asOf: `${date}T12:00:00Z` }];
    const previousLedger = buildLedger({ accounts, transactions: opening, fxRates: rates });
    const ledger = buildLedger({ accounts, transactions, fxRates: rates });
    const previous = valuePortfolio({
      accounts,
      ...previousLedger,
      fxRates: rates,
      date: previousDate,
      quotes: [{ ...quotes[0], price: price("100", "PLN") }],
    });
    const current = valuePortfolio({ accounts, ...ledger, fxRates: rates, date, quotes });
    const flows = sumMoney(
      externalFlows(s.transactions, {
        level: "portfolio",
        securityTransferValue: (t) => grossValue(quotes[0].price, t.quantity),
      }).map((f) => convertMoney(f.amount, rates.onOrBefore(f.amount.currency, "PLN", date))),
      "PLN",
    );
    const change = dayChange({
      valueNow: current.total,
      valuePrevClose: previous.total,
      externalFlows: flows,
    }).change;
    const result = projectDayBreakdown({
      previous,
      current,
      transactions,
      date,
      fx: rates,
      quotes,
      flows,
      change,
    });
    expect(result.positions[0].change.amount.toFixed(), s.name).toBe(s.position);
    expect(result.residualChange.amount.toFixed(), s.name).toBe(s.residual);
    expect(
      sumMoney([...result.positions.map((p) => p.change), result.residualChange], "PLN").amount.eq(
        change.amount,
      ),
      s.name,
    ).toBe(true);
  }
});
test("buy/sale, net dividend and linked fee are allocated once, sold positions remain", () => {
  const result = projectDayBreakdown({
    date,
    fx,
    previous: valuation([["sold", "100"]]),
    current: valuation([["new", "120"]]),
    flows: money("0", "PLN"),
    change: money("28", "PLN"),
    quotes: [],
    transactions: [
      tx("sale", "SELL", { instrumentId: "sold", amount: money("109", "PLN") }),
      tx("buy", "BUY", {
        instrumentId: "new",
        amount: money("-102", "PLN"),
        fee: money("2", "PLN"),
      }),
      tx("div", "DIVIDEND", { instrumentId: "sold", amount: money("4", "PLN") }),
      tx("fee", "FEE", { relatedTransactionId: "buy", amount: money("-3", "PLN") }),
    ],
  });
  expect(result.positions.map((p) => [p.instrumentId, p.change.amount.toFixed()])).toEqual([
    ["sold", "13"],
    ["new", "15"],
  ]);
  expect(result.residualChange.amount.toFixed()).toBe("0");
});
test("paired transfers cancel, external transfers need a quote, split cash belongs to instrument", () => {
  const input = {
    date,
    fx,
    previous: valuation([["i", "100"]]),
    current: valuation([["i", "100"]]),
    flows: money("0", "PLN"),
    change: money("2", "PLN"),
    quotes: [],
    transactions: [
      tx("out", "SECURITY_TRANSFER_OUT", { instrumentId: "i", quantity: quantity("1") }),
      tx("in", "SECURITY_TRANSFER_IN", {
        instrumentId: "i",
        quantity: quantity("1"),
        relatedTransactionId: "out",
      }),
      tx("split", "SPLIT", { instrumentId: "i", cashInLieu: money("2", "PLN") }),
    ],
  };
  expect(projectDayBreakdown(input).positions[0].change.amount.toFixed()).toBe("2");
  const external = { ...input, transactions: [input.transactions[1]] };
  expect(projectDayBreakdown(external).positions[0].change).toBe(null);
  expect(
    projectDayBreakdown({
      ...external,
      quotes: [{ instrumentId: "i", price: price("10", "PLN"), asOf: "2026-10-13T12:00:00Z" }],
    }).positions[0].change.amount.toFixed(),
  ).toBe("-10");
});
test("historical and current FX stay separate; missing current FX and price remain null", () => {
  const usd = fxRate({ base: "USD", quote: "PLN", rate: "4", date, source: "nbp" });
  const previous = {
    ...valuation([]),
    accounts: [
      { fxRate: usd, positions: [{ instrumentId: "i", marketValue: money("10", "USD") }] },
    ],
  };
  const input = {
    date,
    fx,
    previous,
    current: valuation([["i", "45"]]),
    flows: money("0", "PLN"),
    change: money("5", "PLN"),
    quotes: [],
    transactions: [],
  };
  expect(projectDayBreakdown(input).positions[0].change.amount.toFixed()).toBe("5");
  expect(projectDayBreakdown({ ...input, current: valuation([["i", null]]) }).residualChange).toBe(
    null,
  );
  expect(
    projectDayBreakdown({
      ...input,
      transactions: [
        tx("f", "FEE", { relatedTransactionId: "old", amount: money("1", "USD") }),
        {
          ...tx("old", "BUY", { instrumentId: "i", amount: money("-10", "USD") }),
          tradeDate: "2026-10-12",
        },
      ],
    }).positions[0].change,
  ).toBe(null);
});
