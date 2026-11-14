import {
  addDays,
  Decimal,
  daysBetween,
  drawdowns,
  isoDate,
  money,
  portfolioHistory,
  twrIndex,
} from "@oliginvest/core";
import type { DatabaseContext } from "@oliginvest/db";
import { createDrawdownSchema } from "../drawdown-contracts.js";
import { readValuationSeries, type ValuationRow } from "./performance.js";
import type { PortfolioRepository } from "./repository.js";

const schema = createDrawdownSchema();
type DrawdownQuery = {
  accountId?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  maxPoints: number;
};

/** Presentation-only LTTB: Decimal areas, endpoints and worst-episode dates preserved. */
function sample(series: readonly number[], max: number, landmarks: readonly (number | null)[]) {
  if (series.length <= max) return series.map((_, i) => i);
  const kept = new Set(landmarks.filter((i): i is number => i !== null));
  const count = max - kept.size;
  const step = (series.length - 2) / (count - 2);
  let anchor = 0;
  kept.add(0);
  kept.add(series.length - 1);
  for (let bucket = 0; bucket < count - 2; bucket++) {
    const nextStart = Math.floor((bucket + 1) * step) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * step) + 1, series.length);
    let averageX = new Decimal(0),
      averageY = new Decimal(0);
    for (let i = nextStart; i < nextEnd; i++) {
      averageX = averageX.plus(i);
      averageY = averageY.plus(series[i]!);
    }
    averageX = averageX.div(nextEnd - nextStart);
    averageY = averageY.div(nextEnd - nextStart);
    let chosen = Math.floor(bucket * step) + 1,
      largest = new Decimal(-1);
    for (let i = chosen; i < nextStart; i++) {
      const area = new Decimal(anchor)
        .minus(averageX)
        .times(new Decimal(series[i]!).minus(series[anchor]!))
        .minus(new Decimal(anchor - i).times(averageY.minus(series[anchor]!)))
        .abs();
      if (area.gt(largest)) {
        largest = area;
        chosen = i;
      }
    }
    kept.add(chosen);
    anchor = chosen;
  }
  return [...kept].sort((a, b) => a - b);
}

export function drawdownFromRows(
  rows: readonly ValuationRow[],
  currency: string,
  query: { from?: string | undefined; to: string; maxPoints: number },
  now: Date,
) {
  const history = portfolioHistory(rows, { to: query.to, interval: "1d", maxPoints: 3000 }).daily;
  const first = history[0]?.date,
    last = history.at(-1)?.date;
  const from = isoDate(
    query.from && (!first || query.from > first) ? query.from : (first ?? query.to),
  );
  const to = last && last >= from ? last : from;
  const base = first && from > first ? addDays(from, -1) : from;
  const points = history.filter((p) => p.date >= base);
  const starts = new Map<string, string>();
  for (const row of rows)
    if (!starts.has(row.accountId) || row.date < starts.get(row.accountId)!)
      starts.set(row.accountId, row.date);
  const present = new Set(rows.map((r) => `${r.accountId}:${r.date}`));
  const status =
    !points.length || !last || from > last
      ? "no_data"
      : points[0]?.date !== base ||
          points.some(
            (p, i) =>
              p.value === null ||
              p.flow === null ||
              (i > 0 && p.date !== addDays(points[i - 1]!.date, 1)) ||
              [...starts].some(([id, date]) => date <= p.date && !present.has(`${id}:${p.date}`)),
          )
        ? "incomplete"
        : "ok";
  const result =
    status === "ok"
      ? drawdowns(
          twrIndex(
            points.map((p) => ({
              date: p.date,
              value: money(p.value!, currency),
              flow: money(p.flow!, currency),
            })),
          ).map((p) => p.index),
        )
      : null;
  const dateAt = (i: number | null | undefined) => (i == null ? null : points[i]!.date);
  const peakDate = dateAt(result?.peakIndex),
    troughDate = dateAt(result?.troughIndex),
    recoveryDate = dateAt(result?.recoveryIndex);
  const indices = result
    ? sample(result.series, query.maxPoints, [
        result.peakIndex,
        result.troughIndex,
        result.recoveryIndex,
      ])
    : [];
  const stale = status !== "ok" || to < query.to;
  return schema.parse({
    currency,
    from,
    to,
    status,
    maxDrawdown: result ? new Decimal(result.maxDrawdown).toFixed() : null,
    peakDate,
    troughDate,
    recoveryDate,
    durationDays: peakDate && troughDate ? daysBetween(peakDate, troughDate) : null,
    recoveryDays: troughDate && recoveryDate ? daysBetween(troughDate, recoveryDate) : null,
    underwater: {
      t: indices.map((i) => Date.parse(`${points[i]!.date}T00:00:00Z`) / 1000),
      drawdown: indices.map((i) => new Decimal(result!.series[i]!).toFixed()),
    },
    decimated: result !== null && indices.length < result.series.length,
    meta: {
      source: "computed",
      asOf:
        rows
          .filter((r) => r.date === to)
          .map((r) => new Date(r.asOf).toISOString())
          .sort()[0] ?? now.toISOString(),
      delayMinutes: 0,
      stale,
      staleReason: stale ? "no_data" : "eod_only",
    },
  });
}

export function readDrawdown(
  repository: PortfolioRepository,
  context: DatabaseContext,
  query: DrawdownQuery,
) {
  return readValuationSeries(
    repository,
    context,
    { ...query, currency: "base" },
    (rows, currency, range, now) =>
      drawdownFromRows(rows, currency, { ...range, maxPoints: query.maxPoints }, now),
  );
}
