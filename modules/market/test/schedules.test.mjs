import { CurrencyMismatchError, ProviderError, ProviderLimits } from "@oliginvest/data-providers";
import {
  FrankfurterProvider,
  NbpProvider,
  YahooProvider,
} from "@oliginvest/data-providers/adapters";
import { afterEach, expect, test, vi } from "vitest";
import { createMarketJobs, IngestionStore, marketSchedules } from "../dist/src/jobs.js";
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
test("four idempotent schedules use Warsaw civil time", () => {
  expect(marketSchedules.map((s) => [s.job, s.cron, s.tz])).toEqual([
    ["market.fx", "20 12 * * 1-5", "Europe/Warsaw"],
    ["market.gpw", "30 18 * * 1-5", "Europe/Warsaw"],
    ["market.quotes", "* * * * *", "Europe/Warsaw"],
    ["market.us-eod", "30 23 * * 1-5", "Europe/Warsaw"],
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
