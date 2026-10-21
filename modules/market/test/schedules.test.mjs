import { CurrencyMismatchError, ProviderError, ProviderLimits } from "@oliginvest/data-providers";
import {
  FrankfurterProvider,
  NbpProvider,
  YahooProvider,
} from "@oliginvest/data-providers/adapters";
import { afterEach, expect, test, vi } from "vitest";
import { BENCHMARK_HISTORY_DAYS, BENCHMARKS, BENCHMARKS_PER_RUN } from "../dist/src/benchmarks.js";
import {
  createMarketJobs,
  IngestionStore,
  marketSchedules,
  NBP_BACKFILL,
} from "../dist/src/jobs.js";
import {
  MAX_QUOTED_INSTRUMENTS,
  QUOTE_ATTEMPT_MS,
  QUOTE_CYCLE_MS,
  QUOTE_STALE_MS,
  QUOTES_PER_RUN,
  YAHOO_PER_MINUTE,
} from "../dist/src/quote-cadence.js";

const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e";
afterEach(() => vi.restoreAllMocks());
function fixture(instant = "2026-10-07T10:20:00Z") {
  vi.spyOn(ProviderLimits.prototype, "run").mockImplementation((_name, _quota, work) => work());
  vi.spyOn(ProviderLimits.prototype, "singleFlight").mockImplementation((_key, work) => work());
  vi.spyOn(IngestionStore.prototype, "saveFx").mockResolvedValue();
  const transport = vi.fn(() => {
    throw new Error("No network in tests");
  });
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue: {},
    cache: { publish: vi.fn() },
    observed: async () => [id],
    enqueue: vi.fn(),
    now: () => new Date(instant),
    transport,
  });
  return { ...jobs, transport };
}
test("eight idempotent schedules use Warsaw civil time", () => {
  expect(marketSchedules.map((s) => [s.job, s.cron, s.tz])).toEqual([
    ["market.fx", "20 12 * * 1-5", "Europe/Warsaw"],
    ["market.gpw", "30 18 * * 1-5", "Europe/Warsaw"],
    ["market.quotes", "* * * * *", "Europe/Warsaw"],
    ["market.us-eod", "30 23 * * 1-5", "Europe/Warsaw"],
    ["market.gpw-completeness", "30 19 * * 1-5", "Europe/Warsaw"],
    ["market.benchmarks", "45 23 * * 1-5", "Europe/Warsaw"],
    ["market.macro", "0 6 * * *", "Europe/Warsaw"],
    ["market.fx-backfill", "15 5 * * *", "Europe/Warsaw"],
  ]);
});
test("NBP fallback starts at the third failed attempt; no calls after 14:00", async () => {
  const nbp = vi
    .spyOn(NbpProvider.prototype, "getTable")
    .mockRejectedValue(new ProviderError("provider_error"));
  const ecb = vi.spyOn(FrankfurterProvider.prototype, "getFxRate").mockResolvedValue([]);
  const jobs = fixture();
  const input = { scheduledAt: "2026-10-07T10:20:00Z", date: "2026-10-07" };
  await expect(jobs.dispatch("market.fx", input, 1)).rejects.toThrow();
  expect(ecb).not.toHaveBeenCalled();
  await expect(jobs.dispatch("market.fx", input, 2)).rejects.toThrow();
  expect(ecb).toHaveBeenCalledTimes(2);
  nbp.mockClear();
  ecb.mockClear();
  const overdue = fixture("2026-10-07T12:01:00Z");
  await overdue.dispatch("market.fx", input, 3);
  expect(nbp).not.toHaveBeenCalled();
  expect(ecb).not.toHaveBeenCalled();
});
test("holiday without a table keeps last NBP rates instead of requesting ECB", async () => {
  vi.spyOn(NbpProvider.prototype, "getTable").mockRejectedValue(new ProviderError("no_data"));
  const ecb = vi.spyOn(FrankfurterProvider.prototype, "getFxRate").mockResolvedValue([]);
  const jobs = fixture("2026-10-07T12:00:00Z");
  await jobs.dispatch("market.fx", { scheduledAt: "2026-10-07T10:20:00Z", date: "2026-10-07" }, 10);
  expect(ecb).not.toHaveBeenCalled();
});
test("intraday only requests observed instruments with an open session", async () => {
  const active = vi.spyOn(IngestionStore.prototype, "activeIds").mockResolvedValue([]);
  const quote = vi.spyOn(YahooProvider.prototype, "getIntradayQuotes").mockResolvedValue([]);
  const jobs = fixture();
  await jobs.dispatch("market.quotes", {});
  expect(active).toHaveBeenCalledWith([id], "2026-10-07T10:20:00.000Z");
  expect(quote).not.toHaveBeenCalled();
});
test("quote cadence fits the Yahoo budget and derives the stale threshold", () => {
  expect(YAHOO_PER_MINUTE).toBeLessThanOrEqual(12);
  expect(YAHOO_PER_MINUTE - QUOTES_PER_RUN).toBeGreaterThanOrEqual(2);
  expect(MAX_QUOTED_INSTRUMENTS).toBe(50);
  expect(QUOTE_ATTEMPT_MS).toBe(270_000);
  expect(QUOTE_STALE_MS).toBe(420_000);
  expect(QUOTE_STALE_MS).toBeGreaterThan(QUOTE_CYCLE_MS);
});
test("each run quotes at most ten due instruments, each once per cycle", async () => {
  const ids = Array.from(
    { length: 12 },
    (_, n) => `0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d${(0x70 + n).toString(16)}`,
  );
  const markers = new Map();
  const set = vi.fn(async (key, _value, _px, _ms, _nx) => {
    if (markers.has(key)) return null;
    markers.set(key, "1");
    return "OK";
  });
  vi.spyOn(ProviderLimits.prototype, "run").mockImplementation((_name, _quota, work) => work());
  vi.spyOn(ProviderLimits.prototype, "singleFlight").mockImplementation((_key, work) => work());
  vi.spyOn(IngestionStore.prototype, "activeIds").mockResolvedValue(ids);
  vi.spyOn(IngestionStore.prototype, "saveQuotes").mockResolvedValue();
  const quote = vi.spyOn(YahooProvider.prototype, "getIntradayQuotes").mockResolvedValue([]);
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue: {},
    cache: { publish: vi.fn(), set },
    observed: async () => ids,
    enqueue: vi.fn(),
    now: () => new Date("2026-10-07T10:20:00Z"),
    transport: vi.fn(),
  });
  vi.spyOn(jobs.repository, "quotes").mockResolvedValue([]);
  await jobs.dispatch("market.quotes", {});
  await jobs.dispatch("market.quotes", {});
  await jobs.dispatch("market.quotes", {});
  expect(quote.mock.calls).toEqual([[ids.slice(0, 10)], [ids.slice(10)]]);
  expect(set).toHaveBeenCalledWith(`qa:${ids[0]}`, "1", "PX", QUOTE_ATTEMPT_MS, "NX");
});
test("scheduled US EOD skips holidays and requests only the five-session correction window", async () => {
  const jobs = fixture("2026-10-07T21:30:00Z");
  vi.spyOn(jobs.store, "eodIds").mockResolvedValue([id]);
  vi.spyOn(jobs.repository, "resolve").mockResolvedValue({
    id,
    mic: "XNAS",
    symbol: "SYN",
    currency: "USD",
  });
  const session = vi.spyOn(jobs.store, "sessionDates").mockResolvedValue([]);
  const correction = vi.spyOn(jobs.store, "correctionStart").mockResolvedValue("2026-10-01");
  const bars = vi.spyOn(YahooProvider.prototype, "getEodBars").mockResolvedValue([]);
  vi.spyOn(jobs.repository, "saveBars").mockResolvedValue();
  await jobs.dispatch("market.us-eod", {});
  expect(bars).not.toHaveBeenCalled();
  session.mockResolvedValue(["2026-10-07"]);
  await jobs.dispatch("market.us-eod", {});
  expect(correction).toHaveBeenCalledWith("XNAS", "2026-10-07");
  expect(bars).toHaveBeenCalledWith(id, { from: "2026-10-01", to: "2026-10-07" });
});
test("US EOD currency drift records a BLOCK instead of storing the drifted bars", async () => {
  const jobs = fixture("2026-10-07T21:30:00Z");
  vi.spyOn(jobs.store, "eodIds").mockResolvedValue([id]);
  vi.spyOn(jobs.repository, "resolve").mockResolvedValue({
    id,
    mic: "XNAS",
    type: "stock",
    symbol: "SYN",
    currency: "USD",
  });
  vi.spyOn(jobs.store, "sessionDates").mockResolvedValue(["2026-10-07"]);
  vi.spyOn(jobs.store, "correctionStart").mockResolvedValue("2026-10-01");
  vi.spyOn(YahooProvider.prototype, "getEodBars").mockRejectedValue(
    new CurrencyMismatchError("USD", "EUR"),
  );
  const save = vi.spyOn(jobs.repository, "saveBars").mockResolvedValue();
  const record = vi.spyOn(jobs.store, "recordCurrencyChange").mockResolvedValue();
  await jobs.dispatch("market.us-eod", {});
  expect(save).not.toHaveBeenCalled();
  expect(record).toHaveBeenCalledWith(id, "2026-10-07", "USD", "EUR");
});
test("benchmark catalog covers FR-01.09 with ETF proxies naming their index", () => {
  const codes = BENCHMARKS.map((item) => item.code);
  for (const code of ["WIG20", "WIG", "MWIG40", "SWIG80", "SPX", "NDX"])
    expect(codes).toContain(code);
  for (const item of BENCHMARKS.filter((entry) => entry.kind === "etf_proxy"))
    expect(codes).toContain(item.proxyFor);
  expect(new Set(BENCHMARKS.map((item) => item.yahoo)).size).toBe(BENCHMARKS.length);
  expect(BENCHMARK_HISTORY_DAYS).toBeGreaterThanOrEqual(5 * 366);
  expect(BENCHMARKS_PER_RUN).toBeLessThanOrEqual(Math.floor(YAHOO_PER_MINUTE * 0.2));
});
test("benchmarks backfill five years once, then refresh a week, two series per run", async () => {
  const ids = BENCHMARKS.slice(0, 3).map(
    (_, n) => `0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d${(0x70 + n).toString(16)}`,
  );
  const keys = new Map([[`benchmark:backfill:${ids[1]}`, "2021-10-14"]]);
  const queue = {
    get: vi.fn(async (key) => keys.get(key) ?? null),
    set: vi.fn(async (key, value) => keys.set(key, value)),
  };
  vi.spyOn(ProviderLimits.prototype, "singleFlight").mockImplementation((_key, work) => work());
  const enqueue = vi.fn();
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue,
    cache: {},
    observed: async () => [],
    enqueue,
    now: () => new Date("2026-10-19T21:45:00Z"),
    transport: vi.fn(),
  });
  const ensure = vi.spyOn(jobs.store, "ensureBenchmarks").mockResolvedValue(
    ids.map((id, n) => ({
      definition: BENCHMARKS[n],
      id,
      ...(n === 1 ? { first: "2021-10-14", last: "2026-10-16" } : {}),
    })),
  );
  const bars = vi.spyOn(YahooProvider.prototype, "getEodBars").mockResolvedValue([]);
  vi.spyOn(jobs.repository, "saveBars").mockResolvedValue();
  await jobs.dispatch("market.benchmarks", { date: "2026-10-19" });
  expect(ensure).toHaveBeenCalledWith(BENCHMARKS, "2026-10-19");
  // WIG (ids[1]) is a Monte Carlo proxy: its five-year marker does not stop the full backfill.
  expect(bars.mock.calls).toEqual([
    [ids[0], { from: "2021-10-15", to: "2026-10-19" }],
    [ids[1], { from: "1970-01-01", to: "2026-10-19" }],
  ]);
  expect(keys.get(`benchmark:backfill-full:${ids[1]}`)).toBe("1970-01-01");
  expect(keys.get(`benchmark:backfill:${ids[0]}`)).toBe("2021-10-15");
  expect(enqueue).toHaveBeenCalledWith("market.benchmarks", { date: "2026-10-19" }, 60_000);
  // The continuation only reads the remaining series; a 404 ends it for the day, visibly.
  bars.mockClear();
  enqueue.mockClear();
  bars.mockRejectedValueOnce(new ProviderError("no_data"));
  await expect(jobs.dispatch("market.benchmarks", { date: "2026-10-19" })).rejects.toThrow();
  expect(bars.mock.calls).toEqual([[ids[2], { from: "2021-10-15", to: "2026-10-19" }]]);
  expect(enqueue).not.toHaveBeenCalled();
  expect(keys.has(`benchmark:backfill:${ids[2]}`)).toBe(false);
  bars.mockClear();
  await jobs.dispatch("market.benchmarks", { date: "2026-10-19" });
  expect(bars).not.toHaveBeenCalled();
  // Quota delays the job without marking the series done.
  bars.mockRejectedValueOnce(new ProviderError("provider_quota"));
  await expect(jobs.dispatch("market.benchmarks", { date: "2026-10-20" })).rejects.toMatchObject({
    reason: "provider_quota",
  });
  expect(keys.has(`benchmark:done:${ids[0]}:2026-10-20`)).toBe(false);
});
test("Monte Carlo proxies (WIG, S&P 500) backfill full history once, then refresh a week", async () => {
  const proxies = BENCHMARKS.filter((b) => b.fullHistory);
  expect(proxies.map((b) => b.code)).toEqual(["WIG", "SPX", "SPXTR"]);
  expect(proxies.find((b) => b.code === "SPXTR")).toMatchObject({
    yahoo: "^SP500TR",
    verified: false,
  });
  const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d80";
  const keys = new Map([[`benchmark:backfill-full:${id}`, "1970-01-01"]]);
  const queue = {
    get: vi.fn(async (key) => keys.get(key) ?? null),
    set: vi.fn(async (key, value) => keys.set(key, value)),
  };
  vi.spyOn(ProviderLimits.prototype, "singleFlight").mockImplementation((_key, work) => work());
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue,
    cache: {},
    observed: async () => [],
    enqueue: vi.fn(),
    now: () => new Date("2026-10-20T21:45:00Z"),
    transport: vi.fn(),
  });
  vi.spyOn(jobs.store, "ensureBenchmarks").mockResolvedValue([
    { definition: proxies[1], id, first: "1970-01-02", last: "2026-10-19" },
  ]);
  const bars = vi.spyOn(YahooProvider.prototype, "getEodBars").mockResolvedValue([]);
  vi.spyOn(jobs.repository, "saveBars").mockResolvedValue();
  await jobs.dispatch("market.benchmarks", { date: "2026-10-20" });
  expect(bars.mock.calls).toEqual([[id, { from: "2026-10-12", to: "2026-10-20" }]]);
});

test("NBP table A backfill since 2002: 93-day ranges, five per run, resumable, then a no-op", async () => {
  const keys = new Map();
  const queue = {
    get: vi.fn(async (key) => keys.get(key) ?? null),
    set: vi.fn(async (key, value) => keys.set(key, value)),
  };
  vi.spyOn(ProviderLimits.prototype, "run").mockImplementation((_name, _quota, work) => work());
  const saved = vi.spyOn(IngestionStore.prototype, "saveFx").mockResolvedValue();
  const table = vi
    .spyOn(NbpProvider.prototype, "getTable")
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new ProviderError("no_data"))
    .mockResolvedValue([]);
  const enqueue = vi.fn();
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue,
    cache: {},
    observed: async () => [],
    enqueue,
    now: () => new Date("2026-10-20T03:15:00Z"),
    transport: vi.fn(),
  });
  await jobs.dispatch("market.fx-backfill", {});
  expect(table.mock.calls.slice(0, 2)).toEqual([
    ["2002-01-02", "2002-04-04"],
    ["2002-04-05", "2002-07-06"],
  ]);
  expect(table).toHaveBeenCalledTimes(NBP_BACKFILL.perRun);
  for (const [from, to] of table.mock.calls) expect(to >= from).toBe(true);
  expect(saved).toHaveBeenCalledTimes(NBP_BACKFILL.perRun - 1); // the 404 range is skipped
  expect(keys.get(NBP_BACKFILL.next)).toBe("2003-04-12"); // 2002-01-02 + 5 × 93 days
  expect(enqueue).toHaveBeenCalledWith("market.fx-backfill", {}, 60_000);
  // Close to the end the run finishes, marks completion and later runs do nothing.
  keys.set(NBP_BACKFILL.next, "2026-09-01");
  table.mockClear();
  enqueue.mockClear();
  await jobs.dispatch("market.fx-backfill", {});
  expect(table.mock.calls).toEqual([["2026-09-01", "2026-10-19"]]);
  expect(keys.get(NBP_BACKFILL.done)).toBe("2026-10-19");
  expect(enqueue).not.toHaveBeenCalled();
  table.mockClear();
  await jobs.dispatch("market.fx-backfill", {});
  expect(table).not.toHaveBeenCalled();
});
