import {
  brokerFxRate,
  buildLedger,
  convertMoney,
  createFxRateTable,
  fxRate,
  grossValue,
  isoDate,
  money,
  negateMoney,
  price,
  quantity,
} from "@oliginvest/core";
import { expect, test } from "vitest";
import { loadTestVectors, readDecimalText } from "../../../packages/test-vectors/dist/index.js";
import { projectCurrencyExposure, readCurrencyExposure } from "../src/server/currency-exposure.js";

const A = loadTestVectors().A_fifo_fx;
const PLN_ACCOUNT = "01900000-0000-7000-8000-000000000001";
const USD_ACCOUNT = "01900000-0000-7000-8000-000000000002";
const AAPL = "01900000-0000-7000-8000-0000000000a1";
const MSFT = "01900000-0000-7000-8000-0000000000a2";
const SAP = "01900000-0000-7000-8000-0000000000a3";
const d = isoDate;

function trade(id, type, tradeDate, qty, px, mid, currency = "USD", instrumentId = AAPL) {
  const gross = grossValue(price(px, currency), quantity(qty));
  const rate = fxRate({
    base: currency,
    quote: "PLN",
    rate: mid,
    date: tradeDate,
    source: "manual",
  });
  const cash = convertMoney(gross, brokerFxRate(rate, "0.005", type === "BUY" ? "buy" : "sell"));
  return {
    id,
    accountId: PLN_ACCOUNT,
    type,
    tradeDate: d(tradeDate),
    instrumentId,
    quantity: quantity(qty),
    price: price(px, currency),
    amount: type === "BUY" ? negateMoney(cash) : cash,
  };
}
const accounts = [
  { id: PLN_ACCOUNT, currency: "PLN", accountType: "regular" },
  { id: USD_ACCOUNT, currency: "USD", accountType: "regular" },
];
const deposit = (id, accountId, amount, currency) => ({
  id,
  accountId,
  type: "DEPOSIT",
  tradeDate: d("2025-03-01"),
  amount: money(amount, currency),
});
// Vector A (§ 3.7) on the PLN account, plus a USD account trading in its own currency.
const base = [
  deposit("D1", PLN_ACCOUNT, "10000", "PLN"),
  trade("T1", "BUY", "2025-03-03", "10", "240.00", "3.9800"),
  trade("T2", "BUY", "2025-06-02", "5", "200.00", "3.7500"),
  trade("T3", "SELL", "2025-09-02", "12", "230.00", "3.6500"),
  deposit("D2", USD_ACCOUNT, "1000", "USD"),
  {
    id: "M1",
    accountId: USD_ACCOUNT,
    type: "BUY",
    tradeDate: d("2025-04-01"),
    instrumentId: MSFT,
    quantity: quantity("2"),
    price: price("100", "USD"),
    amount: money("-200", "USD"),
  },
];
const nbp = createFxRateTable([
  fxRate({ base: "USD", quote: "PLN", rate: "4.0000", date: "2025-09-30", source: "nbp" }),
]);
const quote = (instrumentId, px) => ({
  instrumentId,
  price: price(px, "USD"),
  asOf: "2025-10-01T00:00:00.000Z",
  source: "yahoo",
});
const input = (overrides = {}) => {
  const ledger = buildLedger({ accounts, transactions: overrides.transactions ?? base });
  return {
    accounts,
    ledger: { positions: ledger.positions, cash: ledger.cash },
    quotes: [quote(AAPL, "210"), quote(MSFT, "110")],
    currencies: new Map([
      [AAPL, "USD"],
      [MSFT, "USD"],
      [SAP, "EUR"],
    ]),
    fx: nbp,
    date: d("2025-10-02"),
    // Synthetic table number for the test only.
    tables: new Map([["USD:PLN:2025-09-30:nbp", "190/A/NBP/2025"]]),
    ...overrides,
  };
};
const now = new Date("2025-10-02T18:00:00Z");

test("vector A remainder: slices, NBP rate with date and table, price/FX effect identity", () => {
  const result = projectCurrencyExposure(input(), now);
  expect(result.status).toBe("ok");
  expect(result.currency).toBe("PLN");
  const [pln, usd] = result.slices;
  expect(pln).toMatchObject({ currency: "PLN", status: "ok", fxRate: null });
  expect(pln.value.amount).toBe("6655.12000000");
  // 630 (AAPL) + 220 (MSFT) + 800 cash, all in USD, at 4.0000.
  expect(usd.valueInCurrency).toEqual({ amount: "1650.00000000", currency: "USD" });
  expect(usd.securities.amount).toBe("3400.00000000");
  expect(usd.cash.amount).toBe("3200.00000000");
  expect(usd.value).toEqual({ amount: "6600.00000000", currency: "PLN" });
  expect(usd.fxRate).toEqual({
    rate: "4",
    rateDate: "2025-09-30",
    source: "nbp",
    tableNo: "190/A/NBP/2025",
  });
  expect(result.total.amount).toBe("13255.12000000");
  expect(typeof usd.weight).toBe("string");
  expect(Number(usd.weight) + Number(pln.weight)).toBeCloseTo(1, 9);
  const [row] = result.decomposition.rows;
  expect(row).toMatchObject({ currency: "USD", status: "ok", positions: 1 });
  expect(row.unrealizedPl.amount).toBe("258.75000000");
  expect(row.priceEffect.amount).toBe("113.06250000");
  expect(row.fxEffect.amount).toBe("145.68750000");
  expect(result.decomposition.total.unrealizedPl.amount).toBe("258.75000000");
  expect(result.decomposition.isComplete).toBe(true);
  // The USD account's own-currency position stays in the exposure but not in the FX effect.
  expect(result.decomposition.exclusions).toEqual([
    { accountId: USD_ACCOUNT, instrumentId: MSFT, currency: "USD", reason: "account_currency" },
  ]);
  expect(result.assumptions).toEqual({
    grouping: "holding_currency",
    prices: "eod_close",
    fxRates: "nbp_table_a_mid",
    view: "economic",
    costBasisMethod: "fifo",
  });
  expect(result.meta).toMatchObject({
    source: "computed",
    delayMinutes: 0,
    stale: false,
    staleReason: "eod_only",
    attribution: "Dane: Yahoo Finance · Kursy: NBP",
  });
  // The ledger cost still matches vector A.
  expect(readDecimalText(A.remaining_after_sale.cost_pln)).toBe("2261.25");
});

test("missing price: segment and total null with a reason, never 0", () => {
  const transactions = [
    ...base,
    trade("S1", "BUY", "2025-05-02", "1", "100", "4.2000", "EUR", SAP),
  ];
  const result = projectCurrencyExposure(input({ transactions }), now);
  expect(result.status).toBe("incomplete");
  expect(result.total).toBeNull();
  const eur = result.slices.find((s) => s.currency === "EUR");
  expect(eur).toMatchObject({ status: "missing_price", value: null, valueInCurrency: null });
  expect(result.slices.every((s) => s.weight === null)).toBe(true);
  expect(result.meta).toMatchObject({ stale: true, staleReason: "no_data" });
  const rows = Object.fromEntries(result.decomposition.rows.map((r) => [r.currency, r]));
  expect(rows.EUR).toMatchObject({ status: "incomplete", unrealizedPl: null, fxEffect: null });
  expect(rows.USD.status).toBe("ok");
  expect(result.decomposition.total.unrealizedPl.amount).toBe("258.75000000");
  expect(result.decomposition.isComplete).toBe(false);
  expect(result.decomposition.exclusions).toContainEqual({
    accountId: PLN_ACCOUNT,
    instrumentId: SAP,
    currency: "EUR",
    reason: "missing_price",
  });
});

test("missing FX rate: USD value stays in USD, PLN amounts and effects are null", () => {
  const result = projectCurrencyExposure(input({ fx: createFxRateTable([]) }), now);
  const usd = result.slices.find((s) => s.currency === "USD");
  expect(usd).toMatchObject({ status: "missing_fx", value: null, fxRate: null });
  expect(usd.valueInCurrency.amount).toBe("1650.00000000");
  expect(result.total).toBeNull();
  expect(result.decomposition.rows[0]).toMatchObject({ status: "incomplete", priceEffect: null });
  expect(result.decomposition.exclusions).toContainEqual({
    accountId: PLN_ACCOUNT,
    instrumentId: AAPL,
    currency: "USD",
    reason: "missing_fx",
  });
  expect(result.decomposition.total.unrealizedPl.amount).toBe("0.00000000");
});

test("missing cost and an empty portfolio", () => {
  const transfer = {
    id: "X1",
    accountId: PLN_ACCOUNT,
    type: "SECURITY_TRANSFER_IN",
    tradeDate: d("2025-05-02"),
    instrumentId: MSFT,
    quantity: quantity("1"),
  };
  const unknown = projectCurrencyExposure(input({ transactions: [transfer] }), now);
  expect(unknown.status).toBe("ok");
  expect(unknown.slices.map((s) => s.currency)).toEqual(["USD"]);
  expect(unknown.slices[0].weight).toBe("1");
  expect(unknown.decomposition.exclusions[0].reason).toBe("missing_cost");
  // Unknown cost: out of the sums, like positions totals, without a null row.
  expect(unknown.decomposition.rows).toEqual([]);
  expect(unknown.decomposition.isComplete).toBe(true);
  const mixed = projectCurrencyExposure(input({ transactions: [...base, transfer] }), now);
  expect(mixed.decomposition.rows[0]).toMatchObject({ status: "ok", positions: 1 });
  expect(mixed.decomposition.rows[0].unrealizedPl.amount).toBe("258.75000000");
  expect(mixed.decomposition.exclusions.map((e) => e.reason).sort()).toEqual([
    "account_currency",
    "missing_cost",
  ]);
  const empty = projectCurrencyExposure(input({ transactions: [], quotes: [] }), now);
  expect(empty).toMatchObject({ status: "no_data", total: null, slices: [] });
  expect(empty.decomposition.rows).toEqual([]);
  expect(empty.meta.asOf).toBe(now.toISOString());
  expect(Object.hasOwn(empty.meta, "attribution")).toBe(false);
});

const emptyRepository = (today = "2025-10-02T12:00:00Z") => ({
  now: () => new Date(today),
  read: async (_, work) =>
    work({ select: () => ({ from: async () => [] }), execute: async () => ({ rows: [] }) }),
});
test("RLS-hidden account returns 404; a future date is rejected", async () => {
  const context = { userId: "owner", role: "user" };
  await expect(
    readCurrencyExposure(emptyRepository(), context, { accountId: [PLN_ACCOUNT] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readCurrencyExposure(emptyRepository(), context, { asOf: "2025-10-03" }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const result = await readCurrencyExposure(emptyRepository(), context, {});
  expect(result).toMatchObject({ status: "no_data", date: "2025-10-02" });
});
