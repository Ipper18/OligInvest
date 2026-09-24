import { CoreError } from "./errors.js";

/**
 * Risk metrics (obliczenia-finansowe.md § 8) on daily returns r_t of the TWR index (fractions,
 * float64 statistics per § 0.1), matching empyrical-reloaded within 1e-6. Every result must be
 * shown with its assumptions: risk-free rate, frequency, window and annualization.
 */
export const PERIODS_PER_YEAR = 252;
export const MIN_RISK_OBSERVATIONS = 60;
/** z for the 95 % one-sided normal quantile used by the parametric VaR (§ 8). */
export const Z_95 = 1.6449;

function fail(message: string): never {
  throw new CoreError("invalid_series", message);
}

function check(series: readonly number[], minimum = 2): void {
  if (series.length < minimum) fail(`At least ${minimum} observations are required`);
  for (const value of series) {
    if (typeof value !== "number" || !Number.isFinite(value))
      fail("Returns must be finite numbers");
  }
}

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

function sampleStdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * A series that does not move: identical values, or a spread that is only floating-point noise
 * relative to its level (C-07). Ratios over such a series are undefined (null), not ±10¹⁶.
 */
function isFlat(xs: readonly number[]): boolean {
  if (Math.max(...xs) === Math.min(...xs)) return true;
  return sampleStdev(xs) <= 1e-12 * Math.max(Math.abs(mean(xs)), 1e-12);
}

function covariance(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  return xs.reduce((sum, x, i) => sum + (x - mx) * ((ys[i] as number) - my), 0) / (xs.length - 1);
}

function pair(xs: readonly number[], ys: readonly number[]): void {
  check(xs);
  check(ys);
  if (xs.length !== ys.length) fail("Series must have the same length");
}

/** Daily risk-free rate (1 + R_f)^(1/P) − 1. */
export function dailyRiskFreeRate(annual: number, periodsPerYear = PERIODS_PER_YEAR): number {
  if (!Number.isFinite(annual) || annual <= -1) fail("Annual risk-free rate must be > −100 %");
  return (1 + annual) ** (1 / periodsPerYear) - 1;
}

/** σ_r·√P with the sample standard deviation (n − 1). */
export function annualVolatility(returns: readonly number[], periodsPerYear = PERIODS_PER_YEAR) {
  check(returns);
  return sampleStdev(returns) * Math.sqrt(periodsPerYear);
}

export interface RatioOptions {
  readonly riskFreeAnnual?: number | undefined;
  readonly periodsPerYear?: number | undefined;
}

/** mean(r − r_f) / std(r − r_f) · √P; null for a zero standard deviation. */
export function sharpeRatio(returns: readonly number[], options: RatioOptions = {}): number | null {
  check(returns);
  const periods = options.periodsPerYear ?? PERIODS_PER_YEAR;
  const rf = dailyRiskFreeRate(options.riskFreeAnnual ?? 0, periods);
  const excess = returns.map((r) => r - rf);
  const sd = sampleStdev(excess);
  return isFlat(excess) ? null : (mean(excess) / sd) * Math.sqrt(periods);
}

/** mean(r − MAR)·P / (DD·√P), DD = √mean(min(r − MAR, 0)²) over all observations. */
export function sortinoRatio(
  returns: readonly number[],
  options: { readonly mar?: number; readonly periodsPerYear?: number } = {},
): number | null {
  check(returns);
  const mar = options.mar ?? 0;
  const periods = options.periodsPerYear ?? PERIODS_PER_YEAR;
  const excess = returns.map((r) => r - mar);
  const downside = Math.sqrt(mean(excess.map((x) => Math.min(x, 0) ** 2)));
  return downside === 0 ? null : (mean(excess) * periods) / (downside * Math.sqrt(periods));
}

/** cov(r, b) / var(b), both with n − 1; null when the benchmark does not move. */
export function beta(returns: readonly number[], benchmark: readonly number[]): number | null {
  pair(returns, benchmark);
  const variance = covariance(benchmark, benchmark);
  return isFlat(benchmark) ? null : covariance(returns, benchmark) / variance;
}

/** Pearson correlation; null when either series does not move. */
export function correlation(
  returns: readonly number[],
  benchmark: readonly number[],
): number | null {
  pair(returns, benchmark);
  const denominator = Math.sqrt(covariance(returns, returns) * covariance(benchmark, benchmark));
  return isFlat(returns) || isFlat(benchmark) ? null : covariance(returns, benchmark) / denominator;
}

function checkConfidence(confidence: number): void {
  if (!(confidence > 0 && confidence < 1)) fail("Confidence must be in (0, 1)");
}

/** Percentile with linear interpolation between order statistics (numpy default). */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  const fraction = position - lower;
  return (
    (sorted[lower] as number) + ((sorted[upper] as number) - (sorted[lower] as number)) * fraction
  );
}

/** Historical 1-day VaR: −percentile_{1−c}(r), as a positive loss fraction. */
export function historicalVar(returns: readonly number[], confidence = 0.95): number {
  check(returns, 1);
  checkConfidence(confidence);
  return -percentile(returns, 1 - confidence);
}

/**
 * Historical 1-day CVaR as in empyrical (§ 8, owner decision 2026-09-24, C-23): the mean of the
 * k = ⌊(n − 1)·(1 − c)⌋ + 1 lowest returns, as a positive loss — well defined with ties.
 */
export function historicalCvar(returns: readonly number[], confidence = 0.95): number {
  check(returns, 1);
  checkConfidence(confidence);
  const k = Math.floor((returns.length - 1) * (1 - confidence)) + 1;
  return -mean([...returns].sort((a, b) => a - b).slice(0, k));
}

/** Parametric 1-day VaR 95 %: −(mean − z·σ), normal distribution (§ 8). */
export function parametricVar(returns: readonly number[], z = Z_95): number {
  check(returns);
  return -(mean(returns) - z * sampleStdev(returns));
}

/**
 * One-sided normal quantile z(c) for the parametric VaR (C-08): the constant 1.6449 of § 8 for
 * 95 %, otherwise the inverse normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
 */
export function zForConfidence(confidence: number): number {
  checkConfidence(confidence);
  if (confidence === 0.95) return Z_95;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const p = confidence;
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** CAGR / |max DD|; null without a drawdown. */
export function calmarRatio(cagr: number, maxDrawdown: number): number | null {
  return maxDrawdown === 0 ? null : cagr / Math.abs(maxDrawdown);
}

export interface RiskMetricsOptions extends RatioOptions {
  readonly benchmark?: readonly number[] | undefined;
  readonly mar?: number | undefined;
  readonly confidence?: number | undefined;
}

export interface RiskMetrics {
  readonly assumptions: {
    readonly riskFreeAnnual: number;
    readonly periodsPerYear: number;
    readonly minimumAcceptableReturn: number;
    readonly confidence: number;
    readonly observations: number;
  };
  /** Fewer than 60 observations: show the values marked „mało danych” (§ 8). */
  readonly insufficientData: boolean;
  readonly meanDaily: number;
  readonly stdevDaily: number;
  readonly volatilityAnnual: number;
  readonly sharpe: number | null;
  readonly sortino: number | null;
  readonly beta: number | null;
  readonly correlation: number | null;
  readonly varHistorical: number;
  readonly cvarHistorical: number;
  readonly varParametric: number;
}

/** All § 8 metrics of one return series with the assumptions they depend on. */
export function riskMetrics(
  returns: readonly number[],
  options: RiskMetricsOptions = {},
): RiskMetrics {
  check(returns);
  const periodsPerYear = options.periodsPerYear ?? PERIODS_PER_YEAR;
  const riskFreeAnnual = options.riskFreeAnnual ?? 0;
  const mar = options.mar ?? 0;
  const confidence = options.confidence ?? 0.95;
  const bench = options.benchmark;
  return Object.freeze({
    assumptions: Object.freeze({
      riskFreeAnnual,
      periodsPerYear,
      minimumAcceptableReturn: mar,
      confidence,
      observations: returns.length,
    }),
    insufficientData: returns.length < MIN_RISK_OBSERVATIONS,
    meanDaily: mean(returns),
    stdevDaily: sampleStdev(returns),
    volatilityAnnual: annualVolatility(returns, periodsPerYear),
    sharpe: sharpeRatio(returns, { riskFreeAnnual, periodsPerYear }),
    sortino: sortinoRatio(returns, { mar, periodsPerYear }),
    beta: bench ? beta(returns, bench) : null,
    correlation: bench ? correlation(returns, bench) : null,
    varHistorical: historicalVar(returns, confidence),
    cvarHistorical: historicalCvar(returns, confidence),
    varParametric: parametricVar(returns, zForConfidence(confidence)),
  });
}
