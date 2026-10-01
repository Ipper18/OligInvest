import { atr, bollingerBands, ema, isCoreError, macd, rsi, sma, toDecimal } from "@oliginvest/core";
import { loadTestVectors, readStatistic, TOLERANCES } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const E = loadTestVectors().E_indicators_talib;
const prices = (list) => list.map((v) => toDecimal(String(readStatistic(v))));
const close = prices(E.close);
const high = prices(E.high);
const low = prices(E.low);

/** Same warm-up (null at the same indices) and values within 1e-8 of TA-Lib 0.8.0 (§ 9). */
function expectSeries(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => {
    if (expected[i] === null) {
      expect(value, `index ${i}`).toBeNull();
    } else {
      expect(value, `index ${i}`).not.toBeNull();
      expect(Math.abs(value - readStatistic(expected[i])), `index ${i}`).toBeLessThanOrEqual(
        TOLERANCES.indicators,
      );
    }
  });
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

describe("technical indicators vs TA-Lib (obliczenia-finansowe.md § 9), vector E", () => {
  test("SMA(5)", () => expectSeries(sma(close, 5), E.SMA5));
  test("EMA(5) seeded with SMA(5)", () => expectSeries(ema(close, 5), E.EMA5));
  test("RSI(14) with Wilder smoothing", () => expectSeries(rsi(close, 14), E.RSI14));

  test("MACD(3, 6, 3): line, signal and histogram from the same index", () => {
    const result = macd(close, 3, 6, 3);
    expectSeries(result.macd, E.MACD_3_6_3.macd);
    expectSeries(result.signal, E.MACD_3_6_3.signal);
    expectSeries(result.histogram, E.MACD_3_6_3.hist);
  });

  test("Bollinger(5, 2) with population standard deviation", () => {
    const result = bollingerBands(close, 5, "2");
    expectSeries(result.upper, E.BBANDS_5_2.upper);
    expectSeries(result.middle, E.BBANDS_5_2.middle);
    expectSeries(result.lower, E.BBANDS_5_2.lower);
  });

  test("ATR(5): mean of the first TRs, then Wilder smoothing", () => {
    expectSeries(atr(high, low, close, 5), E.ATR5);
  });
});

describe("edge cases", () => {
  test("series shorter than the warm-up are all null", () => {
    expect(sma(close.slice(0, 3), 5)).toEqual([null, null, null]);
    expect(ema(close.slice(0, 3), 5)).toEqual([null, null, null]);
    expect(rsi(close.slice(0, 14), 14).every((v) => v === null)).toBe(true);
    expect(
      atr(high.slice(0, 5), low.slice(0, 5), close.slice(0, 5), 5).every((v) => v === null),
    ).toBe(true);
    expect(macd(close.slice(0, 7), 3, 6, 3).macd.every((v) => v === null)).toBe(true);
    expect(sma([], 1)).toEqual([]);
  });

  test("RSI without any movement is 0 and without losses 100 (TA-Lib convention)", () => {
    const flat = Array.from({ length: 6 }, () => toDecimal("10"));
    expect(rsi(flat, 3).slice(3)).toEqual([0, 0, 0]);
    const up = ["1", "2", "3", "4", "5"].map((v) => toDecimal(v));
    expect(rsi(up, 3).slice(3)).toEqual([100, 100]);
  });

  test("invalid parameters and inputs are rejected", () => {
    expect(codeOf(() => sma(close, 0))).toBe("invalid_series");
    expect(codeOf(() => ema(close, 1.5))).toBe("invalid_series");
    expect(codeOf(() => macd(close, 6, 3, 3))).toBe("invalid_series");
    expect(codeOf(() => bollingerBands(close, 5, "-1"))).toBe("invalid_series");
    expect(codeOf(() => atr(high, low.slice(1), close, 5))).toBe("invalid_series");
    expect(codeOf(() => sma([10, 11], 1))).toBe("invalid_series");
  });
});
