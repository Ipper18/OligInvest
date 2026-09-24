import {
  buildLedger,
  createFxRateTable,
  fxRate,
  isCoreError,
  isoDate,
  money,
  sumMoney,
  trailingDividends,
  yieldOnCost,
  yieldOnCostPln,
} from "@oliginvest/core";
import { describe, expect, test } from "vitest";

const d = isoDate;
const accounts = [{ id: "xtb", currency: "PLN", accountType: "regular" }];

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

describe("dividend yield on cost (§ 4.3, FR-02.08)", () => {
  const dividend = (id, date, gross, instrumentId = "KO") => ({
    id,
    accountId: "xtb",
    type: "DIVIDEND",
    tradeDate: d(date),
    instrumentId,
    amount: money(gross, "PLN"),
    gross: money(gross, "PLN"),
  });

  test("gross dividends of the trailing 12 months over the position cost", () => {
    const ledger = buildLedger({
      accounts,
      transactions: [
        dividend("D0", "2024-09-30", "9"),
        dividend("D1", "2024-10-01", "10"),
        dividend("D2", "2025-04-01", "12"),
        dividend("D3", "2025-09-30", "11"),
        dividend("D4", "2025-10-01", "50"),
        dividend("X", "2025-06-01", "99", "PEP"),
      ],
    });
    const records = trailingDividends(ledger.dividends, {
      asOf: d("2025-09-30"),
      accountId: "xtb",
      instrumentId: "KO",
    });
    expect(records.map((r) => r.transactionId)).toEqual(["D1", "D2", "D3"]);
    const gross = sumMoney(
      records.map((r) => r.gross),
      "PLN",
    );
    expect(yieldOnCost(gross, money("660", "PLN"))).toBeCloseTo(0.05, 12);
    expect(yieldOnCost(gross, money("0", "PLN"))).toBeNull();
    expect(codeOf(() => yieldOnCost(money("1", "USD"), money("1", "PLN")))).toBe(
      "currency_mismatch",
    );
  });
});

describe("yield on cost in PLN (owner decision 2026-09-24)", () => {
  test("foreign gross dividends are converted at NBP D-1, as in the tax view, on any account", () => {
    const accountsWithIke = [...accounts, { id: "ike", currency: "PLN", accountType: "ike" }];
    const usd = (id, accountId, date) => ({
      id,
      accountId,
      type: "DIVIDEND",
      tradeDate: d(date),
      instrumentId: "KO",
      amount: money("30", "PLN"),
      gross: money("10", "USD"),
    });
    const rates = createFxRateTable([
      fxRate({ base: "USD", quote: "PLN", rate: "4.00", date: "2025-03-31", source: "nbp" }),
      fxRate({ base: "USD", quote: "PLN", rate: "3.50", date: "2025-06-30", source: "nbp" }),
    ]);
    const ledger = buildLedger({
      accounts: accountsWithIke,
      transactions: [usd("D1", "xtb", "2025-04-01"), usd("D2", "ike", "2025-07-01")],
      taxRates: rates,
    });
    expect(ledger.dividends.map((r) => r.grossPln.amount.toFixed())).toEqual(["40", "35"]);
    expect(ledger.dividends[1].tax).toBeNull();
    expect(yieldOnCostPln(ledger.dividends, money("1500", "PLN"))).toBeCloseTo(0.05, 12);
    const noRates = buildLedger({
      accounts: accountsWithIke,
      transactions: [usd("D2", "ike", "2025-07-01")],
    });
    expect(noRates.dividends[0].grossPln).toBeNull();
    expect(noRates.issues).toEqual([]);
    expect(yieldOnCostPln(noRates.dividends, money("1500", "PLN"))).toBeNull();
    expect(yieldOnCostPln([], money("0", "PLN"))).toBeNull();
    expect(codeOf(() => yieldOnCostPln([], money("1", "USD")))).toBe("currency_mismatch");
  });
});
