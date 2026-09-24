import {
  annualVolatility,
  beta,
  calmarRatio,
  correlation,
  dailyRiskFreeRate,
  historicalCvar,
  historicalVar,
  isCoreError,
  parametricVar,
  riskMetrics,
  sharpeRatio,
  sortinoRatio,
} from "@oliginvest/core";
import { loadTestVectors, readStatistic, TOLERANCES } from "@oliginvest/test-vectors";
import { describe, expect, test } from "vitest";

const D = loadTestVectors().D_risk;
const returns = D.returns.map(readStatistic);
const benchmark = D.benchmark.map(readStatistic);
const near = (actual, key) =>
  expect(Math.abs(actual - readStatistic(D[key])), key).toBeLessThanOrEqual(TOLERANCES.riskMetrics);

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return isCoreError(error) ? error.code : `not-core-error: ${error}`;
  }
  return "no-error";
}

describe("risk metrics (obliczenia-finansowe.md § 8) vs empyrical-reloaded, vector D", () => {
  test("volatility: sample standard deviation × √252", () => {
    near(annualVolatility(returns), "volatility_annual");
    near(annualVolatility(returns), "empyrical_annual_volatility");
  });

  test("Sharpe with R_f = 0 and with R_f = 5 % (daily (1 + R_f)^(1/252) − 1)", () => {
    expect(
      Math.abs(dailyRiskFreeRate(readStatistic(D.rf_annual)) - readStatistic(D.rf_daily)),
    ).toBeLessThanOrEqual(1e-10);
    near(sharpeRatio(returns), "sharpe_rf0");
    near(sharpeRatio(returns, { riskFreeAnnual: readStatistic(D.rf_annual) }), "sharpe_rf5pct");
    near(
      sharpeRatio(returns, { riskFreeAnnual: readStatistic(D.rf_annual) }),
      "empyrical_sharpe_rf5pct",
    );
  });

  test("Sortino with MAR = 0 and downside deviation over all observations", () => {
    near(sortinoRatio(returns), "sortino_mar0");
    near(sortinoRatio(returns), "empyrical_sortino_mar0");
  });

  test("beta (n − 1) and Pearson correlation against the benchmark", () => {
    near(beta(returns, benchmark), "beta");
    near(beta(returns, benchmark), "empyrical_beta");
    near(correlation(returns, benchmark), "correlation");
  });

  test("historical VaR and CVaR 95 % 1D (linear interpolation), parametric VaR", () => {
    near(historicalVar(returns), "var95_historical_1d");
    near(historicalVar(returns), "empyrical_var95");
    near(historicalCvar(returns), "cvar95_historical_1d");
    near(historicalCvar(returns), "empyrical_cvar95");
    near(parametricVar(returns), "var95_parametric_1d");
  });

  test("summary with its assumptions and the minimum sample flag", () => {
    const summary = riskMetrics(returns, { benchmark, riskFreeAnnual: 0.05 });
    expect(summary.assumptions).toEqual({
      riskFreeAnnual: 0.05,
      periodsPerYear: 252,
      minimumAcceptableReturn: 0,
      confidence: 0.95,
      observations: 20,
    });
    expect(summary.insufficientData).toBe(true);
    near(summary.meanDaily, "mean_daily");
    near(summary.stdevDaily, "stdev_daily_sample");
    near(summary.sharpe, "sharpe_rf5pct");
    near(summary.beta, "beta");
    expect(riskMetrics(returns).beta).toBeNull();
    const long = Array.from({ length: 60 }, (_, i) => returns[i % returns.length]);
    expect(riskMetrics(long).insufficientData).toBe(false);
  });
});

describe("edge cases", () => {
  test("Calmar = CAGR / |max DD|, null without a drawdown", () => {
    expect(calmarRatio(0.12, -0.25)).toBeCloseTo(0.48, 12);
    expect(calmarRatio(0.12, 0)).toBeNull();
  });

  test("degenerate series give null instead of infinities", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01])).toBeNull();
    expect(sortinoRatio([0.01, 0.02])).toBeNull();
    expect(beta([0.01, 0.02], [0.01, 0.01])).toBeNull();
    expect(correlation([0.01, 0.01], [0.01, 0.02])).toBeNull();
    expect(historicalCvar([0.01])).toBeCloseTo(-0.01, 12);
  });

  test("invalid input is rejected", () => {
    expect(codeOf(() => annualVolatility([0.01]))).toBe("invalid_series");
    expect(codeOf(() => annualVolatility([0.01, Number.NaN]))).toBe("invalid_series");
    expect(codeOf(() => beta([0.01, 0.02], [0.01]))).toBe("invalid_series");
    expect(codeOf(() => historicalVar([], 0.95))).toBe("invalid_series");
    expect(codeOf(() => historicalVar(returns, 1))).toBe("invalid_series");
    expect(codeOf(() => dailyRiskFreeRate(-2))).toBe("invalid_series");
  });
});
