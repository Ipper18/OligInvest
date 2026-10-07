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
    close.div(toDecimal(previousClose)).minus("1").abs().gt("0.25")
  )
    issues.push("jump_without_action");
  return issues;
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
