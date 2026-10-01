import { drawdowns, isCoreError, isoDate, money, toDecimal, twrIndex } from "@oliginvest/core";
import { loadTestVectors, readStatistic, TOLERANCES } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const C = loadTestVectors().C_drawdown;
const pln = (amount) => money(amount, "PLN");
const d = isoDate;

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

/**
 * Example B (§ 6.4) as daily points: flows are booked at the start of the day, values at the end;
 * "value before the flow" is the previous day's closing value.
 */
const pointsB = [
  { date: d("2025-01-01"), value: pln("10000"), flow: pln("10000") },
  { date: d("2025-03-31"), value: pln("10800") },
  { date: d("2025-04-01"), value: pln("15800"), flow: pln("5000") },
  { date: d("2025-06-30"), value: pln("15200") },
  { date: d("2025-07-01"), value: pln("13200"), flow: pln("-2000") },
  { date: d("2025-12-31"), value: pln("14100") },
];

describe("drawdowns on the TWR index (§ 7), vector C", () => {
  const values = C.values.map((v) => toDecimal(String(readStatistic(v))));
  const result = drawdowns(values);

  test("underwater series and maximum drawdown match empyrical within 1e-6", () => {
    result.series.forEach((dd, i) => {
      expect(Math.abs(dd - readStatistic(C.drawdown_series[i]))).toBeLessThanOrEqual(1e-6);
    });
    expect(Math.abs(result.maxDrawdown - readStatistic(C.max_drawdown))).toBeLessThanOrEqual(
      TOLERANCES.riskMetrics,
    );
    expect(
      Math.abs(result.maxDrawdown - readStatistic(C.empyrical_max_drawdown)),
    ).toBeLessThanOrEqual(1e-6);
  });

  test("peak, trough and recovery indices", () => {
    expect(result.peakIndex).toBe(readStatistic(C.peak_index));
    expect(result.troughIndex).toBe(readStatistic(C.trough_index));
    expect(result.recoveryIndex).toBe(readStatistic(C.recovery_index));
  });

  test("no drawdown, not yet recovered, TWR index input", () => {
    const up = drawdowns(["1", "1.1", "1.2"].map((v) => toDecimal(v)));
    expect(up).toMatchObject({
      maxDrawdown: 0,
      peakIndex: null,
      troughIndex: null,
      recoveryIndex: null,
    });
    const open = drawdowns(["1", "0.8", "0.9"].map((v) => toDecimal(v)));
    expect(open).toMatchObject({ peakIndex: 0, troughIndex: 1, recoveryIndex: null });
    expect(open.maxDrawdown).toBeCloseTo(-0.2, 12);
    const fromIndex = drawdowns(twrIndex(pointsB).map((p) => p.index));
    expect(fromIndex.troughIndex).toBe(3);
    expect(codeOf(() => drawdowns([toDecimal("1"), toDecimal("0")]))).toBe("invalid_series");
    expect(drawdowns([]).series).toEqual([]);
  });
});
