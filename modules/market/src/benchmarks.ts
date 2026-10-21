// Indices and ETF proxies of FR-01.09 (zrodla-danych.md § 4: indices primary from Yahoo). The
// archive type=10 file holds shares only, so index levels and ETFs come from Yahoo chart v8.
// Symbols marked `verified: false` were not confirmed against Yahoo (NIEZWERYFIKOWANE): an
// unknown symbol answers 404, the job skips it and listBenchmarks shows no history for it.
export interface BenchmarkDefinition {
  code: string;
  name: string;
  kind: "index" | "etf_proxy";
  proxyFor?: string;
  yahoo: string;
  ticker: string;
  mic: "XWAR" | "XNYS" | "XNAS" | "ARCX";
  type: "index" | "etf";
  currency: "PLN" | "USD";
  country: "PL" | "US";
  verified: boolean;
  /** Monte Carlo proxy (§ 12.1, ≥ 20 years): backfill the whole available history once. */
  fullHistory?: true;
}
const gpwIndex = (
  code: string,
  name: string,
  verified = false,
  fullHistory = false,
): BenchmarkDefinition => ({
  code,
  name,
  kind: "index",
  yahoo: `${code}.WA`,
  ticker: code,
  mic: "XWAR",
  type: "index",
  currency: "PLN",
  country: "PL",
  verified,
  ...(fullHistory ? { fullHistory: true as const } : {}),
});
const gpwEtf = (ticker: string, name: string, proxyFor: string): BenchmarkDefinition => ({
  code: ticker,
  name,
  kind: "etf_proxy",
  proxyFor,
  yahoo: `${ticker}.WA`,
  ticker,
  mic: "XWAR",
  type: "etf",
  currency: "PLN",
  country: "PL",
  verified: false,
});
export const BENCHMARKS: readonly BenchmarkDefinition[] = [
  gpwIndex("WIG20", "WIG20", true),
  gpwIndex("WIG", "WIG", false, true),
  gpwIndex("MWIG40", "mWIG40"),
  gpwIndex("SWIG80", "sWIG80"),
  {
    code: "SPX",
    name: "S&P 500",
    kind: "index",
    yahoo: "^GSPC",
    ticker: "^GSPC",
    mic: "XNYS",
    type: "index",
    currency: "USD",
    country: "US",
    verified: true,
    fullHistory: true,
  },
  {
    // S&P 500 with dividends: Monte Carlo proxy of US listings (owner decision 2026-10-20).
    // NIEZWERYFIKOWANE: when Yahoo returns no series, api falls back to ^GSPC with a warning.
    code: "SPXTR",
    name: "S&P 500 Total Return",
    kind: "index",
    yahoo: "^SP500TR",
    ticker: "^SP500TR",
    mic: "XNYS",
    type: "index",
    currency: "USD",
    country: "US",
    verified: false,
    fullHistory: true,
  },
  {
    code: "NDX",
    name: "Nasdaq-100",
    kind: "index",
    yahoo: "^NDX",
    ticker: "^NDX",
    mic: "XNAS",
    type: "index",
    currency: "USD",
    country: "US",
    verified: false,
  },
  gpwEtf("ETFBW20TR", "Beta ETF WIG20TR", "WIG20"),
  gpwEtf("ETFBM40TR", "Beta ETF mWIG40TR", "MWIG40"),
  gpwEtf("ETFBS80TR", "Beta ETF sWIG80TR", "SWIG80"),
  {
    code: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    kind: "etf_proxy",
    proxyFor: "SPX",
    yahoo: "SPY",
    ticker: "SPY",
    mic: "ARCX",
    type: "etf",
    currency: "USD",
    country: "US",
    verified: false,
  },
  {
    code: "QQQ",
    name: "Invesco QQQ Trust",
    kind: "etf_proxy",
    proxyFor: "NDX",
    yahoo: "QQQ",
    ticker: "QQQ",
    mic: "XNAS",
    type: "etf",
    currency: "USD",
    country: "US",
    verified: false,
  },
];
/** FR-01.09: at least five years of EOD history; 1830 days cover five years with leap days. */
export const BENCHMARK_HISTORY_DAYS = 1830;
/**
 * Full history of the Monte Carlo proxies (owner decision 2026-10-20): Yahoo `period1 = 0`, still
 * one chart request per series; the source decides how far back the series actually goes.
 */
export const BENCHMARK_FULL_HISTORY_FROM = "1970-01-01";
/**
 * Backfill takes at most 20 % of a provider's budget (strategia-cache § 5.7): 2 of the 12 Yahoo
 * chart requests per minute. The job continues itself a minute later until every series is due.
 */
export const BENCHMARKS_PER_RUN = 2;
export const BENCHMARK_CONTINUE_MS = 60_000;
/** Daily refresh re-reads a week, which holds the five-session correction window. */
export const BENCHMARK_REFRESH_DAYS = 7;
