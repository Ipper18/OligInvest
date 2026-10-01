import { readFileSync } from "node:fs";
import {
  addDays,
  buildLedger,
  createFxRateTable,
  externalFlows,
  fxRate,
  isoDate,
  isWeekday,
  money,
  price,
  quantity,
  roundMoney,
  sumMoney,
  toDecimal,
  valuePortfolio,
} from "@oliginvest/core";
import { describe, expect, test } from "vitest";

/**
 * Integration: docs/03-dane/fixtures/seed-dev.json through the core, compared with its `expected`
 * block (economic view). The seed stores JSON numbers, so it is parsed with source-text access —
 * every number stays exact decimal text and never becomes a float.
 */
const seed = JSON.parse(
  readFileSync(new URL("../../../docs/03-dane/fixtures/seed-dev.json", import.meta.url), "utf8"),
  (_key, value, context) => (typeof value === "number" ? context.source : value),
);
const rounded = (m) => roundMoney(m).amount.toFixed(2);
const same = (a, b) => toDecimal(a).equals(toDecimal(b));

/** Session dates: business days from `firstSession` without a holiday calendar (seed meta). */
function sessionDates() {
  const dates = [];
  let date = isoDate(seed.meta.firstSession);
  while (dates.length < Number(seed.meta.sessions)) {
    if (isWeekday(date)) dates.push(date);
    date = addDays(date, 1);
  }
  return dates;
}

function toTransaction(row) {
  const base = {
    id: `seed-${row.sequence}`,
    accountId: row.account,
    type: row.type,
    tradeDate: isoDate(row.trade_date),
    settleDate: isoDate(row.settle_date),
    sequence: Number(row.sequence),
    amount: money(row.amount, row.cash_currency),
  };
  switch (row.type) {
    case "DEPOSIT":
      return base;
    case "BUY":
      return {
        ...base,
        instrumentId: row.instrument,
        quantity: quantity(row.quantity),
        price: price(row.price, row.price_currency),
        fee: money(row.fee, row.fee_currency),
      };
    case "DIVIDEND":
      return {
        ...base,
        instrumentId: row.instrument,
        gross: money(toDecimal(row.quantity).times(row.price), row.price_currency),
        withholdingTax: money(row.tax, row.tax_currency),
      };
    default:
      throw new Error(`Unmapped seed type ${row.type}`);
  }
}

describe("seed-dev.json through packages/core", () => {
  const dates = sessionDates();
  const accounts = seed.accounts.map((a) => ({
    id: a.key,
    currency: a.currency,
    accountType: a.account_type,
  }));
  const transactions = seed.transactions.map(toTransaction);
  const rates = seed.fxRates.flatMap((series) =>
    series.rates.map((rate, i) =>
      fxRate({ base: series.base, quote: series.quote, rate, date: dates[i], source: "nbp" }),
    ),
  );
  const fxRates = createFxRateTable(rates);
  const baseDate = isoDate(seed.meta.baseDate);
  const quotes = seed.instruments.map((instrument) => ({
    instrumentId: instrument.key,
    price: price(instrument.closes.at(-1), instrument.currency),
    asOf: `${baseDate}T16:00:00Z`,
  }));
  const ledger = buildLedger({ accounts, transactions, taxRates: fxRates });
  const valuation = valuePortfolio({
    accounts,
    positions: ledger.positions,
    cash: ledger.cash,
    quotes,
    fxRates,
    date: baseDate,
  });

  test("session calendar ends on the base date", () => {
    expect(dates.at(-1)).toBe(baseDate);
  });

  test("cash per account and in total", () => {
    for (const balance of ledger.cash) {
      expect(balance.balance.currency).toBe("PLN");
      expect(rounded(balance.balance)).toBe(
        toDecimal(seed.expected.cash[balance.accountId]).toFixed(2),
      );
    }
    const total = sumMoney(
      ledger.cash.map((c) => c.balance),
      "PLN",
    );
    expect(rounded(total)).toBe(toDecimal(seed.expected.cash.total).toFixed(2));
  });

  test("positions: quantity, cost, value and unrealized result per instrument", () => {
    const valued = valuation.accounts.flatMap((a) => a.positions);
    expect(valued.map((p) => p.instrumentId).sort()).toEqual(
      seed.expected.positions.map((p) => p.instrument).sort(),
    );
    for (const expected of seed.expected.positions) {
      const position = valued.find((p) => p.instrumentId === expected.instrument);
      expect(same(position.quantity, expected.quantity)).toBe(true);
      expect(rounded(position.cost)).toBe(toDecimal(expected.cost_pln).toFixed(2));
      expect(rounded(position.marketValue)).toBe(toDecimal(expected.value_pln).toFixed(2));
      expect(rounded(position.unrealizedPl)).toBe(toDecimal(expected.result_pln).toFixed(2));
    }
  });

  test("portfolio value is summed unrounded and rounded once", () => {
    expect(valuation.isComplete).toBe(true);
    expect(rounded(valuation.total)).toBe(toDecimal(seed.expected.portfolioValuePln).toFixed(2));
    // Summing the per-position values after rounding each one would give 47064.48 instead.
    const naive = valuation.accounts
      .flatMap((a) => a.positions.map((p) => roundMoney(p.marketValue)))
      .concat(ledger.cash.map((c) => roundMoney(c.balance)));
    expect(rounded(sumMoney(naive, "PLN"))).toBe("47064.48");
  });

  test("net deposits are the portfolio-level external flows", () => {
    const flows = externalFlows(transactions, { level: "portfolio" });
    expect(
      rounded(
        sumMoney(
          flows.map((f) => f.amount),
          "PLN",
        ),
      ),
    ).toBe(toDecimal(seed.expected.netDepositsPln).toFixed(2));
  });

  test("dividend and tax view are computed without data gaps", () => {
    expect(ledger.issues).toEqual([]);
    expect(ledger.dividends).toHaveLength(1);
    expect(rounded(ledger.dividends[0].tax.topUpPln)).toBe("0.00");
    expect(ledger.sales).toEqual([]);
  });
});
