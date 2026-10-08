import { aggregateMarketBars } from "@oliginvest/core";
import { expect, test } from "vitest";

const bars = [
  {
    date: "2026-10-05",
    open: "10.1",
    high: "10.5",
    low: "10",
    close: "10.2",
    volume: "0.1",
    adjustmentFactor: "0.5",
  },
  {
    date: "2026-10-06",
    open: "10.2",
    high: "11",
    low: "9",
    close: "10.8",
    volume: "0.2",
    adjustmentFactor: "0.5",
  },
];
test("weekly OHLC retains first/last/extremes and sums volume exactly", () => {
  expect(aggregateMarketBars(bars, "1w", 3000, false)).toEqual([
    { date: "2026-10-05", open: "10.1", high: "11", low: "9", close: "10.8", volume: "0.3" },
  ]);
  expect(aggregateMarketBars(bars, "1w", 3000, true)[0]).toMatchObject({
    open: "5.05",
    high: "5.5",
    low: "4.5",
    close: "5.4",
    volume: "0.3",
  });
});
test("monthly bucket spans year boundary and maxPoints never drops total volume", () => {
  const input = Array.from({ length: 10000 }, (_, i) => ({
    ...bars[0],
    adjustmentFactor: "1",
    date: new Date(Date.UTC(1990, 0, i + 1)).toISOString().slice(0, 10),
    volume: "1",
  }));
  const output = aggregateMarketBars(input, "1d", 3000, false);
  expect(output.length).toBeLessThanOrEqual(3000);
  expect(output.reduce((sum, value) => sum + BigInt(value.volume), 0n)).toBe(10000n);
  expect(output.at(-1).close).toBe("10.2");
  expect(
    aggregateMarketBars(
      [
        { ...bars[0], date: "2025-12-31" },
        { ...bars[1], date: "2026-01-01" },
      ],
      "1mo",
      50,
      false,
    ),
  ).toHaveLength(2);
});
test("empty series, null OHLC, input immutability and invalid ordering", () => {
  expect(aggregateMarketBars([], "1d", 50, false)).toEqual([]);
  expect(
    aggregateMarketBars([{ ...bars[0], open: null, high: null, low: null }], "1d", 50, false)[0]
      .open,
  ).toBeNull();
  aggregateMarketBars(bars, "1d", 50, true);
  expect(bars[0].open).toBe("10.1");
  expect(() => aggregateMarketBars([...bars].reverse(), "1d", 50, false)).toThrow();
  expect(() => aggregateMarketBars(bars, "1d", 0, false)).toThrow();
});
