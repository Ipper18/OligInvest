import {
  DATA_QUALITY_RULES,
  inspectMarketBar,
  marketPriceChange,
  PRICE_JUMP_LIMIT,
  scanMarketSeries,
} from "@oliginvest/core";
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
const day = (index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
const candle = (index, close, volume = "1000", extra = {}) => ({
  date: day(index),
  open: close,
  high: close,
  low: close,
  close,
  volume,
  ...extra,
});
test("series scan maps every § 14 code to its severity", () => {
  expect(DATA_QUALITY_RULES).toEqual({
    ohlc_integrity: "BLOCK",
    duplicate: "BLOCK",
    gap: "WARN",
    dead_candles: "WARN",
    jump_without_action: "BLOCK",
    volume_spike: "INFO",
    currency_change: "BLOCK",
    isin_change: "BLOCK",
  });
  expect(PRICE_JUMP_LIMIT).toBe("0.25");
});
test("series scan reports jumps against stored history with Decimal details", () => {
  const history = [candle(0, "100"), candle(1, "100", "0", { noTrades: true, close: "1" })];
  const findings = scanMarketSeries(history, [candle(2, "125.5")], new Set());
  expect(findings).toEqual([
    {
      date: day(2),
      code: "jump_without_action",
      severity: "BLOCK",
      details: { previousClose: "100", close: "125.5", change: "0.25500000" },
    },
  ]);
  expect(scanMarketSeries(history, [candle(2, "125.5")], new Set([day(2)]))).toEqual([]);
  // Jumps inside a batch use the previous batch bar; rejected rows do not anchor the next one.
  expect(
    scanMarketSeries([], [candle(0, "100"), candle(1, "10", "-1"), candle(2, "101")], new Set()),
  ).toEqual([
    { date: day(1), code: "ohlc_integrity", severity: "BLOCK", details: {} },
    {
      date: day(1),
      code: "jump_without_action",
      severity: "BLOCK",
      details: { previousClose: "100", close: "10", change: "-0.90000000" },
    },
  ]);
});
test("series scan flags the first dead candle beyond five sessions only once", () => {
  const dead = (index) => candle(index, "10", "0", { noTrades: true });
  const history = [candle(0, "10"), dead(1), dead(2), dead(3)];
  const batch = [dead(4), dead(5), dead(6), dead(7), candle(8, "10")];
  expect(scanMarketSeries(history, batch, new Set())).toEqual([
    { date: day(6), code: "dead_candles", severity: "WARN", details: { sessions: 6 } },
  ]);
  // Flat zero-volume index levels (stored with noTrades false) are not dead candles.
  const level = (index) => candle(index, "10", "0", { noTrades: false });
  expect(
    scanMarketSeries(
      [],
      Array.from({ length: 7 }, (_, n) => level(n)),
      new Set(),
    ),
  ).toEqual([]);
  // A continuing run in the next batch does not report again; a candle with a range is alive.
  expect(scanMarketSeries([...history, ...batch.slice(0, 3)], [dead(7)], new Set())).toEqual([]);
  expect(
    scanMarketSeries(
      [],
      Array.from({ length: 7 }, (_, index) => candle(index, "10", "0", { high: "11" })),
      new Set(),
    ),
  ).toEqual([]);
});
test("series scan reports volume above 20x the 30-session median as INFO", () => {
  const history = Array.from({ length: 30 }, (_, index) =>
    candle(index, "10", index % 2 ? "100" : "200"),
  );
  // Median of 100/200 alternating is 150; 3000 is exactly 20x and is not a spike.
  expect(scanMarketSeries(history, [candle(30, "10", "3000")], new Set())).toEqual([]);
  expect(scanMarketSeries(history, [candle(30, "10", "3000.0001")], new Set())).toEqual([
    {
      date: day(30),
      code: "volume_spike",
      severity: "INFO",
      details: { volume: "3000.0001", median30: "150" },
    },
  ]);
  // Fewer than 30 sessions or a zero median gives no baseline.
  expect(scanMarketSeries(history.slice(1), [candle(30, "10", "1000000000")], new Set())).toEqual(
    [],
  );
  const quiet = history.map((bar) => ({ ...bar, volume: "0", noTrades: true, high: "11" }));
  expect(scanMarketSeries(quiet, [candle(30, "10", "1")], new Set())).toEqual([]);
});
test("series scan reports non-monotonic batch rows as duplicates", () => {
  expect(
    scanMarketSeries([candle(1, "10")], [candle(1, "10"), candle(0, "10")], new Set()),
  ).toEqual([
    { date: day(1), code: "duplicate", severity: "BLOCK", details: {} },
    { date: day(0), code: "duplicate", severity: "BLOCK", details: {} },
  ]);
});
