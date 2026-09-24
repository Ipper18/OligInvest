import {
  buildLedger,
  isCoreError,
  isoDate,
  money,
  sumMoney,
  trailingDividends,
  yieldOnCost,
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
