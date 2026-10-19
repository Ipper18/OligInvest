import { addDays, isoDate } from "./dates.js";
import { Decimal, toDecimal } from "./decimal.js";

export interface MarketBar {
  date: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  volume: string;
  adjustmentFactor?: string;
  noTrades?: boolean;
}
/** Severity of each check in obliczenia-finansowe.md § 14; only BLOCK excludes a series from FR-04. */
export const DATA_QUALITY_RULES = {
  ohlc_integrity: "BLOCK",
  duplicate: "BLOCK",
  gap: "WARN",
  dead_candles: "WARN",
  jump_without_action: "BLOCK",
  volume_spike: "INFO",
  currency_change: "BLOCK",
  isin_change: "BLOCK",
} as const;
export type DataQualityCode = keyof typeof DATA_QUALITY_RULES;
export type DataQualitySeverity = (typeof DATA_QUALITY_RULES)[DataQualityCode];
/** Owner-approved jump threshold (2026-10-06): strictly more than 25 % without a corporate action. */
export const PRICE_JUMP_LIMIT = "0.25";
/** Flat zero-volume candles are reported once a run is longer than this many sessions. */
export const DEAD_CANDLE_SESSIONS = 5;
export const VOLUME_SPIKE_MULTIPLE = "20";
export const VOLUME_MEDIAN_SESSIONS = 30;
export interface DataQualityFinding {
  date: string;
  code: DataQualityCode;
  severity: DataQualitySeverity;
  details: Record<string, string | number>;
}
/** §14: a hold affects analysis eligibility, never the availability of raw prices. */
export function inspectMarketBar(
  bar: MarketBar,
  previousClose: string | null,
  hasAction: boolean,
): string[] {
  const issues: string[] = [];
  const close = toDecimal(bar.close);
  const open = bar.open === null ? null : toDecimal(bar.open);
  const low = bar.low === null ? null : toDecimal(bar.low);
  const high = bar.high === null ? null : toDecimal(bar.high);
  if (
    toDecimal(bar.volume).isNegative() ||
    (low && (low.gt(close) || (open && low.gt(open)))) ||
    (high && (high.lt(close) || (open && high.lt(open)))) ||
    (low && high && low.gt(high))
  )
    issues.push("ohlc_integrity");
  if (
    !hasAction &&
    previousClose !== null &&
    !toDecimal(previousClose).isZero() &&
    close.div(toDecimal(previousClose)).minus("1").abs().gt(PRICE_JUMP_LIMIT)
  )
    issues.push("jump_without_action");
  return issues;
}
const median = (values: readonly Decimal[]) => {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? new Decimal("0");
  return sorted.length % 2 ? upper : upper.plus(sorted[middle - 1] ?? upper).div(2);
};
// Index levels are stored with `noTrades: false` and no volume; they are never dead candles.
const isDeadCandle = (bar: MarketBar) =>
  bar.noTrades !== false &&
  toDecimal(bar.volume).isZero() &&
  [bar.open, bar.high, bar.low].every((price) => price === null || toDecimal(price).eq(bar.close));
/**
 * Series checks of § 14 that need history: OHLC integrity, jumps, dead candles and volume
 * spikes. `history` holds stored bars before the batch (oldest first; 30 sessions give the
 * volume median), `bars` the new date-sorted, de-duplicated batch. Findings are reported only
 * for batch dates, so re-scanning an overlapping window never moves a finding to another day.
 * Calendar gaps, duplicates and currency or ISIN changes need storage and are checked there.
 */
export function scanMarketSeries(
  history: readonly MarketBar[],
  bars: readonly MarketBar[],
  actionDates: ReadonlySet<string>,
): DataQualityFinding[] {
  const findings: DataQualityFinding[] = [];
  const finding = (date: string, code: DataQualityCode, details = {}) =>
    findings.push({ date, code, severity: DATA_QUALITY_RULES[code], details });
  const series = [...history, ...bars];
  let previousClose: string | null = null;
  let lastDate = "";
  let deadRun = 0;
  for (const [index, bar] of series.entries()) {
    const date = isoDate(bar.date);
    const inBatch = index >= history.length;
    if (date <= lastDate) {
      if (inBatch) finding(date, "duplicate");
      continue;
    }
    lastDate = date;
    deadRun = isDeadCandle(bar) ? deadRun + 1 : 0;
    if (inBatch) {
      for (const code of inspectMarketBar(bar, previousClose, actionDates.has(date)))
        finding(
          date,
          code as DataQualityCode,
          code === "jump_without_action" && previousClose !== null
            ? {
                previousClose,
                close: toDecimal(bar.close).toFixed(),
                change: toDecimal(bar.close).div(toDecimal(previousClose)).minus("1").toFixed(8),
              }
            : {},
        );
      if (deadRun === DEAD_CANDLE_SESSIONS + 1)
        finding(date, "dead_candles", { sessions: DEAD_CANDLE_SESSIONS + 1 });
      const window = series.slice(Math.max(0, index - VOLUME_MEDIAN_SESSIONS), index);
      if (window.length === VOLUME_MEDIAN_SESSIONS) {
        const typical = median(window.map((item) => toDecimal(item.volume)));
        const volume = toDecimal(bar.volume);
        if (typical.gt("0") && volume.gt(typical.times(VOLUME_SPIKE_MULTIPLE)))
          finding(date, "volume_spike", {
            volume: volume.toFixed(),
            median30: typical.toFixed(),
          });
      }
    }
    // Rejected rows (negative volume) are not stored, so they cannot anchor the next jump.
    if (!bar.noTrades && !toDecimal(bar.volume).isNegative())
      previousClose = toDecimal(bar.close).toFixed();
  }
  return findings;
}
export function marketPriceChange(
  price: string,
  previous: string,
): { change: string; changeRatio?: number } {
  const change = toDecimal(price).minus(toDecimal(previous));
  return {
    change: change.toFixed(),
    ...(!toDecimal(previous).isZero()
      ? { changeRatio: change.div(toDecimal(previous)).toNumber() }
      : {}),
  };
}
function mergeBars(bars: readonly MarketBar[]): MarketBar {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) throw new Error("Empty candle group");
  const extremum = (column: "high" | "low") => {
    const values = bars
      .map((bar) => bar[column])
      .filter((value): value is string => value !== null)
      .map(toDecimal);
    return values.length
      ? (column === "high" ? Decimal.max(...values) : Decimal.min(...values)).toFixed()
      : null;
  };
  return {
    date: first.date,
    open: first.open,
    high: extremum("high"),
    low: extremum("low"),
    close: last.close,
    volume: bars.reduce((sum, bar) => sum.plus(toDecimal(bar.volume)), new Decimal("0")).toFixed(),
  };
}
/** Financial arithmetic stays here; canvas consumes a conversion of this final result only. */
export function aggregateMarketBars(
  input: readonly MarketBar[],
  interval: "1d" | "1w" | "1mo",
  maxPoints: number,
  adjusted: boolean,
): MarketBar[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 3000)
    throw new Error("Invalid point limit");
  const groups = new Map<string, MarketBar[]>();
  let previous = "";
  for (const value of input) {
    const date = isoDate(value.date);
    if (date <= previous) throw new Error("Duplicate or non-monotonic bars");
    previous = date;
    const factor = adjusted ? toDecimal(value.adjustmentFactor ?? "1") : new Decimal("1");
    if (!factor.isPositive()) throw new Error("Invalid adjustment factor");
    const scale = (price: string | null) =>
      price === null ? null : toDecimal(price).times(factor).toFixed();
    const bar = {
      date,
      open: scale(value.open),
      high: scale(value.high),
      low: scale(value.low),
      close: toDecimal(value.close).times(factor).toFixed(),
      volume: toDecimal(value.volume).toFixed(),
    };
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const key =
      interval === "1mo"
        ? date.slice(0, 7)
        : interval === "1w"
          ? addDays(date, -(weekday === 0 ? 6 : weekday - 1))
          : date;
    const group = groups.get(key) ?? [];
    group.push(bar);
    groups.set(key, group);
  }
  const bars = [...groups.values()].map(mergeBars);
  if (bars.length <= maxPoints) return bars;
  const output: MarketBar[] = [];
  const size = Math.ceil(bars.length / maxPoints);
  for (let index = 0; index < bars.length; index += size)
    output.push(mergeBars(bars.slice(index, index + size)));
  return output;
}
