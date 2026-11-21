import { expect, test } from "vitest";
import { allocationDrift, evaluatePortfolioAlert } from "../src/portfolio-alert.ts";

test("portfolio conditions compare strict magnitudes, rearm below the band and deduplicate observations", () => {
  const observe = (value, minute, state) =>
    evaluatePortfolioAlert(
      value,
      "0.1",
      "0.01",
      5,
      new Date(Date.UTC(2026, 10, 20, 10, minute)).toISOString(),
      state,
    );
  expect(observe("0.1", 0).triggered).toBe(false);
  const first = observe("-0.11", 1);
  expect(first.triggered).toBe(true);
  expect(observe(null, 2, first.state).state).toBe(first.state);
  expect(observe("0.08", 1, first.state).state).toBe(first.state);
  expect(observe("0.095", 2, first.state).state.armed).toBe(false);
  const rearmed = observe("0.09", 3, first.state).state;
  expect(observe("0.12", 4, rearmed).triggered).toBe(false);
  expect(observe("0.12", 6, rearmed).triggered).toBe(true);
});

test("a missing valuation does not become a zero allocation", () => {
  expect(allocationDrift("0", [{ key: "cash", weight: "1" }], new Map())).toBeNull();
  expect(allocationDrift("100", [{ key: "cash", weight: "0.65" }], new Map([["cash", "50"]]))).toBe(
    "0.15",
  );
});
