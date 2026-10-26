import { Decimal, macd, sma } from "@oliginvest/core";
import { expect, test } from "vitest";
import { indicatorSpec } from "../src/indicator-spec.ts";
import { MarketRepository } from "../src/server/repository.ts";

test("indicator parameters reject zero periods, malformed specs and reversed MACD windows", () => {
  for (const spec of ["sma:0", "atr:000", "macd:26:12:9", "ema:-1", "rsi:2:3", "bb:20:2.22"])
    expect(indicatorSpec.safeParse(spec).success).toBe(false);
  for (const spec of ["sma:20", "ema:50", "bb:20:2", "rsi:14", "macd:12:26:9", "atr:14"])
    expect(indicatorSpec.parse(spec)).toBe(spec);
});

test("API indicators use full adjusted intervals, retain null warmup and align display dates", async () => {
  const full = Array.from({ length: 4001 }, (_, index) => ({
    date: new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10),
    open: String(index + 10),
    high: String(index + 12),
    low: String(index + 8),
    close: String(index + 11),
    volume: "100",
    adjustmentFactor: "0.5",
  }));
  const chosen = [0, 1, 5, 20, 3999, 4000];
  const id = "01900000-0000-7000-8000-000000000101";
  const response = {
    interval: "1d",
    t: chosen.map((i) => Date.parse(`${full[i].date}T00:00:00Z`) / 1000),
    meta: { source: "gpw", asOf: "2010-12-31T00:00:00Z", delayMinutes: 0, stale: false },
  };
  const repository = new MarketRepository({});
  repository.chartData = async () => ({ full, response });
  const output = await repository.indicators({}, id, {
    spec: ["sma:5", "macd:3:6:3"],
    interval: "1d",
    maxPoints: 50,
  });
  const close = full.map((bar) => new Decimal(bar.close).times("0.5"));
  expect(output.indicators[0].outputs.value).toEqual(chosen.map((i) => sma(close, 5)[i]));
  expect(output.indicators[1].outputs.macd).toEqual(
    chosen.map((i) => macd(close, 3, 6, 3).macd[i]),
  );
  expect(output.t).toEqual(response.t);
});
