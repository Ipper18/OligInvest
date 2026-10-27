import { expect, test } from "vitest";
import { projectQuickSnapshot, quickText } from "../src/server/service.js";

const money = (amount) => ({ amount, currency: "PLN" });
const meta = { source: "mixed", asOf: "2026-10-26T12:00:00Z", delayMinutes: 15, stale: true };
const snapshot = {
  summary: {
    totalValue: money("123"),
    dayChange: null,
    dayChangeRatio: null,
    unrealizedPl: money("0"),
    isComplete: false,
    meta,
    exclusions: { count: 1 },
  },
  day: { change: null, changeRatio: null, meta },
  positions: [],
  gaps: [{ kind: "fx", base: "USD", quote: "PLN" }],
  previousGaps: [],
  missingCosts: ["0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e"],
};
test("partial values never masquerade as complete totals or zero P/L", () => {
  const value = projectQuickSnapshot(snapshot, "portfolio");
  expect(value.totalValue).toBeNull();
  expect(value.unrealizedPl).toBeNull();
  expect(value.dayChange).toBeNull();
  expect(value.incomplete).toBe(true);
  expect(value.reasons).toContainEqual({ code: "missing_fx_rate", pair: "USD/PLN" });
  expect(value.reasons).toContainEqual({
    code: "missing_cost_basis",
    instrumentId: snapshot.missingCosts[0],
  });
  expect(quickText("portfolio", value)).toContain("brak kursu USD/PLN");
});
test("a complete empty portfolio is zero, not missing data", () => {
  const complete = {
    ...snapshot,
    gaps: [],
    previousGaps: [],
    missingCosts: [],
    summary: {
      ...snapshot.summary,
      isComplete: true,
      totalValue: money("0"),
      unrealizedPl: money("0"),
      dayChange: money("0"),
      exclusions: { count: 0 },
    },
    day: { ...snapshot.day, change: money("0") },
  };
  expect(projectQuickSnapshot(complete, "portfolio")).toMatchObject({
    totalValue: money("0"),
    incomplete: false,
    reasons: [],
  });
  expect(projectQuickSnapshot(complete, "today")).toMatchObject({
    dayChange: money("0"),
    incomplete: false,
  });
});
