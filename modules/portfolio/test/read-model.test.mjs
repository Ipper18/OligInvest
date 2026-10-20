import {
  buildLedger,
  createFxRateTable,
  currencyCode,
  isoDate,
  money,
  price,
  quantity,
} from "@oliginvest/core";
import { expect, test } from "vitest";
import { projectPortfolio } from "../src/server/read-model.js";
import { projectRealized } from "../src/server/read-service.js";

const a = "0198a000-0000-7000-8000-000000000001",
  b = "0198a000-0000-7000-8000-000000000002",
  i = "0198a000-0000-7000-8000-000000000003";
const accounts = [a, b].map((id) => ({
  id,
  name: id,
  currency: currencyCode("PLN"),
  accountType: "regular",
}));
const instruments = [
  {
    id: i,
    ticker: "TEST",
    name: "Test",
    mic: "XWAR",
    currency: "PLN",
    type: "stock",
    isActive: true,
  },
];
const transactions = accounts.map((account, n) => ({
  id: `0198a000-0000-7000-8000-00000000000${n + 4}`,
  accountId: account.id,
  type: "SECURITY_TRANSFER_IN",
  instrumentId: i,
  tradeDate: isoDate("2026-10-12"),
  quantity: quantity("2"),
  ...(n === 0 ? { acquisitionCost: money("10", "PLN"), acquiredOn: isoDate("2026-10-09") } : {}),
}));
const input = () => ({
  accounts,
  instruments,
  ledger: buildLedger({ accounts, transactions }),
  quotes: [
    {
      instrumentId: i,
      price: price("8", "PLN"),
      asOf: "2026-10-12T16:00:00Z",
      meta: { source: "gpw", asOf: "2026-10-12T16:00:00Z", delayMinutes: 0, stale: false },
    },
  ],
  fx: createFxRateTable([]),
  date: isoDate("2026-10-12"),
  view: "economic",
  groupBy: "account_instrument",
});
test("valued unknown-cost holdings stay visible and are excluded from cost/P&L totals", () => {
  const result = projectPortfolio(input());
  expect(result.data).toHaveLength(2);
  expect(result.data[1].costBasis).toBeNull();
  expect(result.data[1].unrealizedPl).toBeNull();
  expect(result.totals.exclusions).toEqual({
    count: 1,
    positions: [{ accountId: b, instrumentId: i }],
  });
  expect(result.totals.marketValueBase.amount).toBe("32.00000000");
  expect(result.totals.unrealizedPl.amount).toBe("6.00000000");
});
test("instrument aggregation has no account and never turns a mixed unknown cost into zero", () => {
  const result = projectPortfolio({ ...input(), groupBy: "instrument" });
  expect(result.data).toHaveLength(1);
  expect(result.data[0]).not.toHaveProperty("accountId");
  expect(result.data[0].quantity).toBe("4");
  expect(result.data[0].costBasis).toBeNull();
  expect(result.data[0].marketValueBase.amount).toBe("32.00000000");
});
test("missing quote retains quantities, marks partial totals and has no fake weight", () => {
  const result = projectPortfolio({ ...input(), quotes: [] });
  expect(result.isComplete).toBe(false);
  expect(result.data).toHaveLength(2);
  for (const p of result.data) {
    expect(p.marketValue).toBeNull();
    expect(p.marketValueBase).toBeNull();
    expect(p.weight).toBeNull();
  }
  expect(result.meta.staleReason).toBe("no_data");
});
test("a quote without account FX preserves the instrument value but not its base value", () => {
  const state = input();
  const result = projectPortfolio({
    ...state,
    quotes: [{ ...state.quotes[0], price: price("8", "USD") }],
    instruments: [{ ...instruments[0], currency: "USD" }],
  });
  expect(result.isComplete).toBe(false);
  expect(result.data[0].marketValue.amount).toBe("16.00000000");
  expect(result.data[0].marketValueBase).toBeNull();
  expect(result.data[0].weight).toBeNull();
});

test("missing quotes preserve quantities in both grouping modes", () => {
  for (const groupBy of ["instrument", "account_instrument"]) {
    const result = projectPortfolio({ ...input(), quotes: [], groupBy });
    expect(result.data.map((p) => p.quantity)).toEqual(
      groupBy === "instrument" ? ["4"] : ["2", "2"],
    );
    expect(result.data.every((p) => p.unrealizedPl === null)).toBe(true);
  }
});

test("the aggregate reports missing FX even when its first account has a conversion", () => {
  const state = input();
  const foreignAccounts = [accounts[0], { ...accounts[1], currency: currencyCode("USD") }];
  const foreignTransactions = transactions.map((t) => ({
    ...t,
    acquisitionCost: undefined,
    acquiredOn: undefined,
  }));
  const result = projectPortfolio({
    ...state,
    accounts: foreignAccounts,
    ledger: buildLedger({ accounts: foreignAccounts, transactions: foreignTransactions }),
    groupBy: "instrument",
  });
  expect(result.data[0].quantity).toBe("4");
  expect(result.data[0].marketValue.amount).toBe("32.00000000");
  expect(result.data[0].marketValueBase).toBeNull();
  expect(result.data[0].meta.staleReason).toBe("no_data");
});

test.each(["regular", "ike", "ikze"])(
  "realized %s preserves missing tax data or inapplicability",
  (accountType) => {
    const taxAccounts = [{ ...accounts[0], accountType }];
    const txs = [
      {
        id: transactions[0].id,
        accountId: a,
        type: "BUY",
        instrumentId: i,
        tradeDate: isoDate("2026-10-09"),
        quantity: quantity("2"),
        price: price("5", "PLN"),
        amount: money("-10", "PLN"),
      },
      {
        id: transactions[1].id,
        accountId: a,
        type: "SELL",
        instrumentId: i,
        tradeDate: isoDate("2026-10-12"),
        quantity: quantity("1"),
        price: price("8", "PLN"),
        amount: money("8", "PLN"),
      },
    ];
    const fx = createFxRateTable([]);
    const ledger = buildLedger({ accounts: taxAccounts, transactions: txs });
    const result = projectRealized(
      ledger.sales,
      { fx, transactions: txs, taxSettings: undefined },
      {},
      "tax",
    );
    expect(result.isComplete).toBe(false);
    expect(result.rows[0].status).toBe(
      accountType === "regular" ? "missing_tax_data" : "not_applicable",
    );
    expect(result.rows[0].cost).toBeNull();
    expect(result.rows[0].realizedPl).toBeNull();
    expect(result.rows[0].proceeds).toBeNull();
  },
);
