import { isCoreError, RISK_FREE_SERIES, riskFreeRateOn } from "@oliginvest/core";
import { describe, expect, test } from "vitest";

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : String(error);
  }
  return "no-error";
};

describe("risk-free rate in force (§ 8, BL-319)", () => {
  const nbp = [
    { date: "2025-05-08", value: "5.25" },
    { date: "2025-07-03", value: "5.00" },
    { date: "2024-01-01", value: "5.75" },
  ];
  test("the NBP reference rate is a step function valid until the next decision", () => {
    expect(riskFreeRateOn("PLN", nbp, "2025-07-02")).toEqual({
      currency: "PLN",
      seriesCode: "NBP:REF_RATE",
      annualRate: 0.0525,
      effectiveDate: "2025-05-08",
      stale: false,
    });
    expect(riskFreeRateOn("PLN", nbp, "2026-10-20")).toMatchObject({
      annualRate: 0.05,
      effectiveDate: "2025-07-03",
      stale: false,
    });
  });
  test("FRED DGS3MO is stale after a week without observations", () => {
    const fred = [
      { date: "2026-10-09", value: "4.07" },
      { date: "2026-10-12", value: "4.05" },
    ];
    expect(riskFreeRateOn("USD", fred, "2026-10-19")).toMatchObject({
      seriesCode: RISK_FREE_SERIES.USD.code,
      annualRate: 0.0405,
      stale: false,
    });
    expect(riskFreeRateOn("USD", fred, "2026-10-20").stale).toBe(true);
  });
  test("no observation yet is null, never an implicit 0 %", () => {
    expect(riskFreeRateOn("PLN", nbp, "2023-12-31")).toBeNull();
    expect(riskFreeRateOn("USD", [], "2026-10-20")).toBeNull();
  });
  test("rejects duplicates, implausible values and invalid dates", () => {
    expect(codeOf(() => riskFreeRateOn("PLN", [...nbp, nbp[0]], "2026-01-01"))).toBe(
      "invalid_series",
    );
    expect(
      codeOf(() => riskFreeRateOn("PLN", [{ date: "2026-01-01", value: "75" }], "2026-01-02")),
    ).toBe("invalid_series");
    expect(codeOf(() => riskFreeRateOn("PLN", nbp, "2026-13-01"))).toBe("invalid_date");
  });
});
