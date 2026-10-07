import { inspectMarketBar, marketPriceChange } from "@oliginvest/core";
import { expect, test } from "vitest";

const bar = { date: "2026-10-06", open: "100", high: "125", low: "75", close: "125", volume: "1" };
test("quality uses strict 25% threshold in Decimal, including the negative tail", () => {
  expect(inspectMarketBar(bar, "100", false)).toEqual([]);
  expect(
    inspectMarketBar({ ...bar, high: "125.00000001", close: "125.00000001" }, "100", false),
  ).toEqual(["jump_without_action"]);
  expect(inspectMarketBar({ ...bar, low: "74.99", close: "74.99" }, "100", false)).toEqual([
    "jump_without_action",
  ]);
  expect(inspectMarketBar({ ...bar, high: "200", close: "200" }, "100", true)).toEqual([]);
});
test("OHLC validation accepts partial EOD but rejects inconsistent ranges and negative volume", () => {
  expect(inspectMarketBar({ ...bar, low: "101" }, null, false)).toContain("ohlc_integrity");
  expect(inspectMarketBar({ ...bar, high: "99" }, null, false)).toContain("ohlc_integrity");
  expect(inspectMarketBar({ ...bar, volume: "-1" }, null, false)).toContain("ohlc_integrity");
  expect(inspectMarketBar({ ...bar, open: null, high: null, low: null }, "0", false)).toEqual([]);
});
test("price change preserves decimals and zero denominator has no ratio", () => {
  expect(marketPriceChange("0.3", "0.1")).toEqual({ change: "0.2", changeRatio: 2 });
  expect(marketPriceChange("0.3", "0")).toEqual({ change: "0.3" });
});
