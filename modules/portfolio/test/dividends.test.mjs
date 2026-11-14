import {
  buildLedger,
  createFxRateTable,
  fxRate,
  isoDate,
  money,
  price,
  quantity,
} from "@oliginvest/core";
import { expect, test } from "vitest";
import { loadTestVectors, readDecimalText } from "../../../packages/test-vectors/dist/index.js";
import { projectDividends, readDividends } from "../src/server/dividends.js";

const G = loadTestVectors().G_dividend;
const PLN_ACCOUNT = "01900000-0000-7000-8000-000000000001";
const USD_ACCOUNT = "01900000-0000-7000-8000-000000000002";
const IKE_ACCOUNT = "01900000-0000-7000-8000-000000000003";
const KO = "01900000-0000-7000-8000-0000000000b1";
const PKO = "01900000-0000-7000-8000-0000000000b2";
const id = (n) => `01900000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;
const d = isoDate;
const accounts = [
  { id: PLN_ACCOUNT, currency: "PLN", accountType: "regular" },
  { id: USD_ACCOUNT, currency: "USD", accountType: "regular" },
  { id: IKE_ACCOUNT, currency: "PLN", accountType: "ike" },
];
const instruments = [
  {
    id: KO,
    ticker: "KO",
    name: "Synthetic KO",
    mic: "XNYS",
    currency: "USD",
    type: "stock",
    isActive: true,
  },
  {
    id: PKO,
    ticker: "PKO",
    name: "Synthetic PKO",
    mic: "XWAR",
    currency: "PLN",
    type: "stock",
    isActive: true,
  },
];
// Vector G (§ 4.3): 100 × 0.25 USD gross, 15 % withholding, credited 77.81 PLN; NBP D-1 3.6900.
const dividend = (n, extra = {}) => ({
  id: id(n),
  accountId: PLN_ACCOUNT,
  type: "DIVIDEND",
  tradeDate: d("2025-08-14"),
  instrumentId: KO,
  amount: money("77.81", "PLN"),
  gross: money("25.00", "USD"),
  withholdingTax: money("3.75", "USD"),
  ...extra,
});
const buy = (n, accountId, cost, currency = "PLN") => ({
  id: id(n),
  accountId,
  type: "BUY",
  tradeDate: d("2025-01-10"),
  settleDate: d("2025-01-13"),
  instrumentId: KO,
  quantity: quantity("100"),
  price: price("60", "USD"),
  amount: money(`-${cost}`, currency),
});
const rates = createFxRateTable([
  fxRate({ base: "USD", quote: "PLN", rate: "3.6900", date: "2025-08-13", source: "nbp" }),
  fxRate({ base: "USD", quote: "PLN", rate: "4.0000", date: "2025-01-10", source: "nbp" }),
]);
const input = (transactions, overrides = {}) => {
  const ledger = buildLedger({ accounts, transactions, taxRates: overrides.taxRates ?? rates });
  return {
    accounts,
    ledger: { dividends: ledger.dividends, positions: ledger.positions },
    instruments,
    to: d("2025-12-31"),
    // Synthetic table number for the test only.
    tables: new Map([["USD:PLN:2025-08-13", "155/A/NBP/2025"]]),
    ...overrides,
  };
};
const now = new Date("2025-12-31T18:00:00Z");
const round = (m) => Number(m.amount).toFixed(2);

test("vector G: gross, withholding, net in USD and PLN, NBP rate with table, top-up estimate", () => {
  const result = projectDividends(input([dividend(1)]), now);
  expect(result).toMatchObject({ currency: "PLN", status: "ok", from: null, to: "2025-12-31" });
  const [row] = result.rows;
  expect(row.gross).toEqual({ amount: "25.00000000", currency: "USD" });
  expect(row.withholdingTax.amount).toBe("3.75000000");
  expect(Number(row.net.amount).toFixed(4)).toBe(readDecimalText(G.net_usd));
  expect(Number(row.credited.amount).toFixed(2)).toBe(readDecimalText(G.credited_pln_economic));
  expect(round(row.grossPln)).toBe(readDecimalText(G.gross_pln_tax_view));
  expect(row.withholdingTaxPln.amount).toBe("13.83750000");
  expect(row.netPln.amount).toBe("78.41250000");
  expect(row.fxRate).toEqual({
    rate: "3.69",
    rateDate: "2025-08-13",
    source: "nbp",
    tableNo: "155/A/NBP/2025",
  });
  expect(row.tax.status).toBe("computed");
  expect(round(row.tax.taxDuePln)).toBe(readDecimalText(G.pl_tax_19_pln));
  expect(round(row.tax.withholdingCreditPln)).toBe(readDecimalText(G.wht_credit_pln));
  expect(round(row.tax.estimatedTopUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
  expect(row.gaps).toEqual([]);
  expect(result.totals).toMatchObject({ payments: 1, taxablePayments: 1, isComplete: true });
  expect(round(result.totals.estimatedTopUpPln)).toBe("3.69");
  expect(result.byYear.map((y) => y.year)).toEqual([2025]);
  expect(result.totalsByCurrency).toEqual([
    {
      currency: "USD",
      payments: 1,
      gross: { amount: "25.00000000", currency: "USD" },
      withholdingTax: { amount: "3.75000000", currency: "USD" },
      net: { amount: "21.25000000", currency: "USD" },
    },
  ]);
  expect(result.assumptions).toEqual({
    incomeDate: "payment_date",
    fxRates: "nbp_table_a_mid_previous_business_day",
    plTaxRate: "0.19",
    withholdingCredit: "capped_at_pl_rate",
    topUp: "estimate",
    yieldOnCost: "trailing_12m_gross_pln_over_open_cost_pln",
    costBasisMethod: "fifo",
  });
  expect(result.meta).toMatchObject({
    source: "computed",
    stale: false,
    attribution: "Kursy: NBP",
  });
  expect(Object.hasOwn(result.meta, "staleReason")).toBe(false);
});

test("missing withholding: null with a reason in the row, the year and the totals — never 0", () => {
  const result = projectDividends(
    input([dividend(1), dividend(2, { withholdingTax: undefined, tradeDate: d("2024-08-14") })]),
    now,
  );
  expect(result.status).toBe("incomplete");
  const gap = result.rows.find((r) => r.transactionId === id(2));
  expect(gap).toMatchObject({
    withholdingTax: null,
    net: null,
    withholdingTaxPln: null,
    netPln: null,
    // The 2024 rate is missing too in this table, so the gross in PLN is also unknown.
    gaps: ["missing_fx", "missing_withholding"],
    grossPln: null,
    tax: { status: "missing_fx", estimatedTopUpPln: null, taxDuePln: null },
  });
  const onlyWithholding = projectDividends(input([dividend(3, { withholdingTax: undefined })]), now)
    .rows[0];
  expect(onlyWithholding).toMatchObject({
    gaps: ["missing_withholding"],
    tax: { status: "missing_withholding", estimatedTopUpPln: null },
  });
  expect(round(onlyWithholding.grossPln)).toBe("92.25");
  expect(result.totals).toMatchObject({
    isComplete: false,
    grossPln: null,
    withholdingTaxPln: null,
    estimatedTopUpPln: null,
  });
  const years = Object.fromEntries(result.byYear.map((y) => [y.year, y.totals]));
  expect(round(years[2025].estimatedTopUpPln)).toBe("3.69");
  expect(years[2024]).toMatchObject({ isComplete: false, estimatedTopUpPln: null });
  expect(result.totalsByCurrency[0]).toMatchObject({
    payments: 2,
    withholdingTax: null,
    net: null,
  });
  expect(result.gaps).toEqual([
    { reason: "missing_fx", payments: 1 },
    { reason: "missing_withholding", payments: 1 },
  ]);
  expect(result.meta).toMatchObject({ stale: true, staleReason: "no_data" });
});

test("missing NBP rate: PLN amounts and the rate are null, the payout currency stays", () => {
  const result = projectDividends(input([dividend(1)], { taxRates: createFxRateTable([]) }), now);
  const [row] = result.rows;
  expect(row).toMatchObject({
    grossPln: null,
    withholdingTaxPln: null,
    netPln: null,
    fxRate: null,
    gaps: ["missing_fx"],
    tax: { status: "missing_fx", estimatedTopUpPln: null },
  });
  expect(row.net.amount).toBe("21.25000000");
  expect(result.gaps).toEqual([{ reason: "missing_fx", payments: 1 }]);
  expect(Object.hasOwn(result.meta, "attribution")).toBe(false);
});

test("IKE: PLN amounts shown, the top-up does not apply and is not summed as 0", () => {
  const result = projectDividends(input([dividend(1, { accountId: IKE_ACCOUNT })]), now);
  expect(result.rows[0].tax).toEqual({
    status: "not_applicable",
    taxDuePln: null,
    withholdingCreditPln: null,
    estimatedTopUpPln: null,
  });
  expect(result.totals).toMatchObject({
    taxablePayments: 0,
    taxExemptPayments: 1,
    estimatedTopUpPln: null,
    isComplete: true,
  });
  expect(result.status).toBe("ok");
});

test("PLN dividend with Polish withholding: no rate needed, top-up is a known 0", () => {
  const result = projectDividends(
    input([
      dividend(1, {
        instrumentId: PKO,
        gross: money("500", "PLN"),
        withholdingTax: money("95", "PLN"),
        amount: money("405", "PLN"),
      }),
    ]),
    now,
  );
  expect(result.rows[0]).toMatchObject({ fxRate: null, gaps: [] });
  expect(result.rows[0].tax.estimatedTopUpPln.amount).toBe("0.00000000");
  expect(result.rows[0].netPln.amount).toBe("405.00000000");
});

test("yield on cost: trailing 12 months gross in PLN over the open FIFO cost in PLN", () => {
  const transactions = [
    buy(10, PLN_ACCOUNT, "24600"),
    dividend(1),
    dividend(2, { tradeDate: d("2024-12-01") }),
  ];
  const result = projectDividends(input(transactions), now);
  const [ko] = result.byInstrument;
  expect(ko.instrument.ticker).toBe("KO");
  // 92.25 / 24 600 = 0.00375; the 2024 payment is outside the 12 months.
  expect(ko.yieldOnCost).toEqual({
    ratio: "0.00375",
    trailingGrossPln: { amount: "92.25000000", currency: "PLN" },
    costPln: { amount: "24600.00000000", currency: "PLN" },
    asOf: "2025-12-31",
    reason: null,
  });
  // A range filter narrows the rows, not the 12-month window of the yield.
  const ranged = projectDividends(input(transactions, { from: d("2025-09-01") }), now);
  expect(ranged.rows).toEqual([]);
  expect(ranged.status).toBe("no_data");
});

test("yield on cost reasons: no position, cost not in PLN (Z-29), unknown cost, missing rate", () => {
  const reason = (transactions, overrides) =>
    projectDividends(input(transactions, overrides), now).byInstrument[0].yieldOnCost;
  expect(reason([dividend(1)]).reason).toBe("no_open_position");
  const usd = reason([
    buy(10, USD_ACCOUNT, "6000", "USD"),
    dividend(1, { accountId: USD_ACCOUNT, amount: money("21.25", "USD") }),
  ]);
  expect(usd).toMatchObject({ reason: "missing_cost_pln", ratio: null, costPln: null });
  expect(usd.trailingGrossPln.amount).toBe("92.25000000");
  const transfer = {
    id: id(11),
    accountId: PLN_ACCOUNT,
    type: "SECURITY_TRANSFER_IN",
    tradeDate: d("2025-01-10"),
    instrumentId: KO,
    quantity: quantity("100"),
  };
  expect(reason([transfer, dividend(1)]).reason).toBe("missing_cost");
  const noRate = reason([buy(10, PLN_ACCOUNT, "24600"), dividend(1)], {
    taxRates: createFxRateTable([]),
  });
  expect(noRate).toMatchObject({ reason: "missing_fx", ratio: null, trailingGrossPln: null });
  expect(noRate.costPln.amount).toBe("24600.00000000");
});

test("instrument filter and an empty selection", () => {
  const transactions = [
    dividend(1),
    dividend(2, {
      instrumentId: PKO,
      gross: money("10", "PLN"),
      withholdingTax: money("1.9", "PLN"),
      amount: money("8.1", "PLN"),
    }),
  ];
  const only = projectDividends(input(transactions, { instrumentId: PKO }), now);
  expect(only.rows.map((r) => r.instrument.ticker)).toEqual(["PKO"]);
  const empty = projectDividends(input([]), now);
  expect(empty).toMatchObject({ status: "no_data", rows: [], byYear: [], byInstrument: [] });
  // No payment is a known empty sum, not a gap; the status says no_data.
  expect(empty.totals).toMatchObject({ payments: 0, estimatedTopUpPln: null, isComplete: true });
  expect(empty.totals.grossPln.amount).toBe("0.00000000");
});

const emptyRepository = (today = "2025-10-02T12:00:00Z") => ({
  now: () => new Date(today),
  read: async (_, work) =>
    work({ select: () => ({ from: async () => [] }), execute: async () => ({ rows: [] }) }),
});
test("RLS-hidden account returns 404; future or inverted ranges are rejected", async () => {
  const context = { userId: "owner", role: "user" };
  await expect(
    readDividends(emptyRepository(), context, { accountId: [PLN_ACCOUNT] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readDividends(emptyRepository(), context, { to: "2025-10-03" }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  await expect(
    readDividends(emptyRepository(), context, { from: "2025-05-02", to: "2025-05-01" }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  const result = await readDividends(emptyRepository(), context, {});
  expect(result).toMatchObject({ status: "no_data", to: "2025-10-02", from: null });
});
