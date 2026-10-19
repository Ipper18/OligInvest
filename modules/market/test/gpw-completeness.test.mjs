import { expect, test, vi } from "vitest";
import {
  formatGpwCompleteness,
  GPW_COMPLETENESS_SESSIONS,
  GPW_COMPLETENESS_TARGET,
  summarizeGpwCompleteness,
} from "../dist/src/gpw-completeness.js";
import { createMarketJobs } from "../dist/src/jobs.js";

const day = (n) => new Date(Date.UTC(2026, 10, 2 + n)).toISOString().slice(0, 10);
const sessions = (count, overrides = {}) =>
  Array.from({ length: count }, (_, n) => ({
    date: day(n),
    automatic: 400,
    manual: 0,
    requested: true,
    ...overrides[n],
  }));
test("ADR-005 criterion: 20 sessions, at least 95 % complete automatic days", () => {
  expect([GPW_COMPLETENESS_SESSIONS, GPW_COMPLETENESS_TARGET]).toEqual([20, 0.95]);
  const pass = summarizeGpwCompleteness(
    sessions(20, { 3: { automatic: 0, requested: true } }),
    "x",
  );
  expect([pass.completeSessions, pass.ratio, pass.verdict]).toEqual([19, 0.95, "pass"]);
  const fail = summarizeGpwCompleteness(
    sessions(20, { 3: { automatic: 0 }, 7: { automatic: 0, manual: 400, requested: false } }),
    "x",
  );
  expect([fail.completeSessions, fail.verdict]).toEqual([18, "fail"]);
  expect(fail.sessions[3].status).toBe("missing");
  expect(fail.sessions[7].status).toBe("manual");
  expect(summarizeGpwCompleteness(sessions(19), "x").verdict).toBe("insufficient");
});
test("partial files fall below 95 % of the median day; the window keeps the latest 20", () => {
  const report = summarizeGpwCompleteness(
    sessions(22, { 0: { automatic: 0 }, 5: { automatic: 379 }, 6: { automatic: 380 } }).reverse(),
    "2026-11-23",
  );
  expect(report.sessions.map((row) => row.date)).toEqual(
    Array.from({ length: 20 }, (_, n) => day(n + 2)),
  );
  expect(report.referenceCount).toBe(400);
  expect(report.sessions.find((row) => row.date === day(5)).status).toBe("partial");
  expect(report.sessions.find((row) => row.date === day(6)).status).toBe("complete");
  expect(summarizeGpwCompleteness([], "x")).toMatchObject({ ratio: 0, referenceCount: 0 });
});
test("report table states facts for the session report", () => {
  const text = formatGpwCompleteness(
    summarizeGpwCompleteness(sessions(20, { 1: { automatic: 0, requested: false } }), "2026-11-21"),
  );
  expect(text).toContain(
    "19/20 sesji z kompletem (95,0 %; próg 95,0 % z 20 sesji) — werdykt: PASS",
  );
  expect(text).toContain(`| ${day(1)} | 0 | 0 | nie | brak |`);
});
test("completeness job stores the report with archive request markers", async () => {
  const keys = new Map([[`quota:gpw:archive:${day(0)}`, "requested"]]);
  const queue = {
    get: vi.fn(async (key) => keys.get(key) ?? null),
    set: vi.fn(async (key, value) => keys.set(key, value)),
  };
  const report = vi.fn();
  const jobs = createMarketJobs({
    database: { transaction: vi.fn() },
    queue,
    cache: {},
    observed: async () => [],
    enqueue: vi.fn(),
    report,
    now: () => new Date("2026-11-03T18:30:00Z"),
    transport: vi.fn(),
  });
  const counts = vi.spyOn(jobs.store, "gpwSessionCounts").mockResolvedValue([
    { date: day(1), automatic: 0, manual: 0 },
    { date: day(0), automatic: 410, manual: 0 },
  ]);
  await jobs.dispatch("market.gpw-completeness", { date: day(1) });
  expect(counts).toHaveBeenCalledWith(day(1), 20);
  const stored = JSON.parse(keys.get("report:gpw-completeness:latest"));
  expect(stored.sessions.map((row) => [row.date, row.requested, row.status])).toEqual([
    [day(0), true, "complete"],
    [day(1), false, "missing"],
  ]);
  expect(stored.verdict).toBe("insufficient");
  expect(stored.markdown).toContain("werdykt: za mało sesji");
  expect(queue.set).toHaveBeenCalledWith(
    `report:gpw-completeness:${day(1)}`,
    expect.any(String),
    "PX",
    90 * 86_400_000,
  );
  expect(report).toHaveBeenCalledWith(
    "market.gpw-completeness",
    expect.objectContaining({ verdict: "insufficient" }),
  );
});
