import { brokerFxRate, fxRate, midFxRate } from "@oliginvest/core";
import { expect, test } from "vitest";

test("recovers the mid without counting broker margin twice", () => {
  const mid = fxRate({
    base: "USD",
    quote: "PLN",
    rate: "3.98",
    date: "2025-03-03",
    source: "manual",
  });
  for (const side of ["buy", "sell"])
    expect(midFxRate(brokerFxRate(mid, "0.005", side), "0.005", side).rate.toFixed()).toBe("3.98");
  expect(() => midFxRate(mid, "1", "sell")).toThrow();
});
