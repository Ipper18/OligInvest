import {
  buildLedger,
  createFxRateTable,
  dividendPlnView,
  fxRate,
  isoDate,
  money,
  roundMoney,
  sumDividendPlnViews,
  yieldOnCost,
  yieldOnCostRatio,
} from "@oliginvest/core";
import { loadTestVectors, readDecimalText } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const { G_dividend: G } = loadTestVectors();
const d = isoDate;
const rounded = (m) => roundMoney(m).amount.toFixed(2);
const accounts = [
  { id: "xtb", currency: "PLN", accountType: "regular" },
  { id: "ike", currency: "PLN", accountType: "ike" },
];
const nbp = createFxRateTable([
  fxRate({ base: "USD", quote: "PLN", rate: "3.6900", date: "2025-08-13", source: "nbp" }),
]);
// Vector G (§ 4.3): 100 shares × 0.25 USD, 15 % withholding, credited 77.81 PLN.
const dividend = (extra = {}) => ({
  id: "DIV",
  accountId: "xtb",
  type: "DIVIDEND",
  tradeDate: d("2025-08-14"),
  instrumentId: "KO",
  amount: money("77.81", "PLN"),
  gross: money("25.00", "USD"),
  withholdingTax: money("3.75", "USD"),
  ...extra,
});
const ledgerOf = (transactions, taxRates = nbp) =>
  buildLedger({ accounts, transactions, taxRates });

describe("dividend PLN view (BL-307, FR-02.08) — vector G", () => {
  test("gross, withholding, net and the estimated top-up at NBP D-1", () => {
    const [record] = ledgerOf([dividend()]).dividends;
    expect(record.withholdingRecorded).toBe(true);
    expect(record.rate).toMatchObject({ rate: expect.anything(), date: "2025-08-13" });
    const view = dividendPlnView(record);
    expect(view.taxStatus).toBe("computed");
    expect(view.gaps).toEqual([]);
    expect(rounded(view.grossPln)).toBe(readDecimalText(G.gross_pln_tax_view));
    expect(rounded(view.taxDuePln)).toBe(readDecimalText(G.pl_tax_19_pln));
    expect(rounded(view.withholdingCreditPln)).toBe(readDecimalText(G.wht_credit_pln));
    expect(rounded(view.topUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
    // 3.75 · 3.69 = 13.8375 and 92.25 − 13.8375; unrounded until presentation.
    expect(view.withholdingTaxPln.amount.toFixed()).toBe("13.8375");
    expect(view.netPln.amount.toFixed()).toBe("78.4125");
    expect(view.grossPln.amount.minus(view.withholdingTaxPln.amount).eq(view.netPln.amount)).toBe(
      true,
    );
  });

  test("a withholding tax booked as a linked TAX row counts as recorded", () => {
    const tax = {
      id: "WHT",
      accountId: "xtb",
      type: "TAX",
      tradeDate: d("2025-08-14"),
      amount: money("-3.75", "USD"),
      relatedTransactionId: "DIV",
    };
    const [record] = ledgerOf([
      dividend({ withholdingTax: undefined, amount: money("25", "USD") }),
      tax,
    ]).dividends;
    expect(record.withholdingRecorded).toBe(true);
    expect(rounded(dividendPlnView(record).topUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
  });

  test("missing withholding: withholding, net and top-up are null with a reason, never 0", () => {
    const [record] = ledgerOf([dividend({ withholdingTax: undefined })]).dividends;
    expect(record.withholdingRecorded).toBe(false);
    const view = dividendPlnView(record);
    expect(view).toMatchObject({
      taxStatus: "missing_withholding",
      withholdingTaxPln: null,
      netPln: null,
      topUpPln: null,
      taxDuePln: null,
      gaps: ["missing_withholding"],
    });
    expect(rounded(view.grossPln)).toBe(readDecimalText(G.gross_pln_tax_view));
    // An explicit zero is a known value, not a gap.
    const zero = dividendPlnView(
      ledgerOf([dividend({ withholdingTax: money("0", "USD") })]).dividends[0],
    );
    expect(zero.taxStatus).toBe("computed");
    expect(rounded(zero.topUpPln)).toBe("17.53");
  });

  test("missing NBP rate: every PLN amount is null with a reason", () => {
    const view = dividendPlnView(ledgerOf([dividend()], createFxRateTable([])).dividends[0]);
    expect(view).toMatchObject({
      grossPln: null,
      withholdingTaxPln: null,
      netPln: null,
      taxStatus: "missing_fx",
      topUpPln: null,
      gaps: ["missing_fx"],
    });
    const both = dividendPlnView(
      ledgerOf([dividend({ withholdingTax: undefined })], createFxRateTable([])).dividends[0],
    );
    expect(both.gaps).toEqual(["missing_fx", "missing_withholding"]);
    expect(both.taxStatus).toBe("missing_fx");
  });

  test("IKE: amounts in PLN, the top-up does not apply", () => {
    const view = dividendPlnView(ledgerOf([dividend({ accountId: "ike" })]).dividends[0]);
    expect(view.taxStatus).toBe("not_applicable");
    expect(view.topUpPln).toBeNull();
    expect(rounded(view.netPln)).toBe("78.41");
  });

  test("PLN dividend with Polish withholding needs no rate; top-up 0 is a known value", () => {
    const view = dividendPlnView(
      ledgerOf([
        dividend({
          gross: money("500", "PLN"),
          withholdingTax: money("95", "PLN"),
          amount: money("405", "PLN"),
        }),
      ]).dividends[0],
    );
    expect(view.gaps).toEqual([]);
    expect(view.topUpPln.amount.toFixed()).toBe("0");
    expect(view.netPln.amount.toFixed()).toBe("405");
  });

  test("totals: unknown addends make the sum null; tax-exempt payments are counted apart", () => {
    const views = ledgerOf([
      dividend(),
      dividend({ id: "DIV2", accountId: "ike" }),
      dividend({ id: "DIV3", withholdingTax: undefined }),
    ]).dividends.map(dividendPlnView);
    const all = sumDividendPlnViews(views);
    expect(all).toMatchObject({
      payments: 3,
      taxablePayments: 2,
      taxExemptPayments: 1,
      isComplete: false,
      withholdingTaxPln: null,
      netPln: null,
      topUpPln: null,
    });
    expect(all.grossPln.amount.toFixed()).toBe("276.75");
    const known = sumDividendPlnViews(views.slice(0, 2));
    expect(known.isComplete).toBe(true);
    expect(rounded(known.topUpPln)).toBe(readDecimalText(G.estimated_topup_pln));
    expect(sumDividendPlnViews(views.slice(1, 2)).topUpPln).toBeNull();
    expect(sumDividendPlnViews([])).toMatchObject({ payments: 0, isComplete: true });
  });

  test("yieldOnCostRatio keeps the decimal; yieldOnCost is its number", () => {
    const ratio = yieldOnCostRatio(money("33", "PLN"), money("660", "PLN"));
    expect(ratio.toFixed()).toBe("0.05");
    expect(yieldOnCost(money("33", "PLN"), money("660", "PLN"))).toBe(0.05);
    expect(yieldOnCostRatio(money("33", "PLN"), money("0", "PLN"))).toBeNull();
  });
});
