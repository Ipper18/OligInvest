import { addDays, compareIsoDates, type IsoDate, isoDate } from "./dates.js";
import { Decimal, toDecimal } from "./decimal.js";
import { CoreError } from "./errors.js";

/** One row of `portfolio.valuations_daily` in PLN; `null` = unknown (missing rate or flow value). */
export interface AccountValuationRow {
  readonly accountId: string;
  readonly date: string;
  readonly totalValuePln: string | null;
  readonly externalFlowPln: string | null;
  readonly isComplete: boolean;
}

export interface HistoryPoint {
  readonly date: IsoDate;
  /** Σ account values; `null` when any account of the day is incomplete or unknown — never 0. */
  readonly value: Decimal | null;
  /** Cumulative external flows since the first valuation; `null` from the first unknown flow on. */
  readonly netContributions: Decimal | null;
  /** External flows of the day (§ 0.4: deposit +, withdrawal −); `null` when unknown. */
  readonly flow: Decimal | null;
}

export interface PortfolioHistoryOptions {
  readonly from?: string | undefined;
  readonly to: string;
  readonly interval: "1d" | "1w" | "1mo";
  /** NFR-01.04: at most this many points after decimation (50–3000). */
  readonly maxPoints: number;
}

export interface PortfolioHistoryResult {
  readonly points: readonly HistoryPoint[];
  /** Daily points within the range, before sampling and decimation (flow markers use these). */
  readonly daily: readonly HistoryPoint[];
  readonly decimated: boolean;
}

const sum = (values: readonly (string | null)[]): Decimal | null =>
  values.some((value) => value === null)
    ? null
    : values.reduce(
        (total: Decimal, value) => total.plus(toDecimal(value as string)),
        new Decimal(0),
      );

function periodKey(date: IsoDate, interval: PortfolioHistoryOptions["interval"]): string {
  if (interval === "1mo") return date.slice(0, 7);
  if (interval === "1d") return date;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -(weekday === 0 ? 6 : weekday - 1));
}

/**
 * Value history vs net contributions (FR-02.10) from stored daily valuations (§ 5). Accounts are
 * summed per day without intermediate rounding; a gap stays `null`. Weekly and monthly series take
 * the period-end point; decimation keeps the last point of each bucket so the latest value survives.
 */
export function portfolioHistory(
  rows: readonly AccountValuationRow[],
  options: PortfolioHistoryOptions,
): PortfolioHistoryResult {
  const { maxPoints } = options;
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 3000)
    throw new CoreError("invalid_series", "Invalid point limit", { maxPoints });
  const to = isoDate(options.to);
  const from = options.from === undefined ? undefined : isoDate(options.from);
  if (from !== undefined && compareIsoDates(from, to) > 0)
    throw new CoreError("invalid_date", "Range must not end before it starts", { from, to });
  const days = new Map<IsoDate, AccountValuationRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const date = isoDate(row.date);
    const key = `${row.accountId}:${date}`;
    if (seen.has(key))
      throw new CoreError("invalid_series", "Duplicate account valuation", {
        accountId: row.accountId,
        date,
      });
    seen.add(key);
    if (compareIsoDates(date, to) > 0) continue;
    const group = days.get(date) ?? [];
    group.push(row);
    days.set(date, group);
  }
  const daily: HistoryPoint[] = [];
  let contributions: Decimal | null = new Decimal(0);
  for (const date of [...days.keys()].sort(compareIsoDates)) {
    const group = days.get(date) as AccountValuationRow[];
    const flow = sum(group.map((row) => row.externalFlowPln));
    contributions = contributions !== null && flow !== null ? contributions.plus(flow) : null;
    if (from !== undefined && compareIsoDates(date, from) < 0) continue;
    daily.push(
      Object.freeze({
        date,
        value: group.every((row) => row.isComplete)
          ? sum(group.map((row) => row.totalValuePln))
          : null,
        netContributions: contributions,
        flow,
      }),
    );
  }
  const sampled: HistoryPoint[] = [];
  let previousKey: string | undefined;
  for (const point of daily) {
    const key = periodKey(point.date, options.interval);
    if (key === previousKey) sampled[sampled.length - 1] = point;
    else sampled.push(point);
    previousKey = key;
  }
  let points = sampled;
  if (sampled.length > maxPoints) {
    const size = Math.ceil(sampled.length / maxPoints);
    points = [];
    for (let index = size - 1; index < sampled.length + size - 1; index += size)
      points.push(sampled[Math.min(index, sampled.length - 1)] as HistoryPoint);
  }
  return Object.freeze({
    points: Object.freeze(points),
    daily: Object.freeze(daily),
    decimated: points.length < daily.length,
  });
}
