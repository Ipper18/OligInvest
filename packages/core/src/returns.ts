import { addDays, addMonths, daysBetween, type IsoDate, isoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import { assertSameCurrency, type Money, money } from "./money.js";

/** End-of-day value V_d and external flow F_d booked at the start of day d (§ 6.2, § 0.4). */
export interface PerformancePoint {
  readonly date: IsoDate;
  readonly value: Money;
  readonly flow?: Money | undefined;
}

export interface TwrIndexPoint {
  readonly date: IsoDate;
  /** V*: product of (1 + r_d) up to this day, starting from 1 before the first point. */
  readonly index: Decimal;
  /** r_d = V_d / (V_{d−1} + F_d) − 1; null when V_{d−1} + F_d ≤ 0 (period closed, § 6.2). */
  readonly dailyReturn: number | null;
}

function ratio(value: Decimal): number {
  return value.isZero() ? 0 : value.toNumber();
}

function series(message: string): never {
  throw new CoreError("invalid_series", message);
}

/** Daily chain of the time-weighted return (obliczenia-finansowe.md § 6.2), exact in Decimal. */
export function twrIndex(points: readonly PerformancePoint[]): TwrIndexPoint[] {
  const currency = points[0]?.value.currency;
  let previous = new Decimal(0);
  let index = new Decimal(1);
  return points.map((point, i) => {
    isoDate(point.date);
    if (i > 0 && point.date <= (points[i - 1] as PerformancePoint).date) {
      series("Points must have strictly increasing dates");
    }
    assertSameCurrency(currency as string, point.value.currency);
    if (point.flow) assertSameCurrency(currency as string, point.flow.currency);
    const base = point.flow ? previous.plus(point.flow.amount) : previous;
    let dailyReturn: number | null = null;
    if (base.isPositive() && !base.isZero()) {
      const growth = point.value.amount.div(base);
      index = index.times(growth);
      dailyReturn = ratio(growth.minus(1));
    }
    previous = point.value.amount;
    return Object.freeze({ date: point.date, index, dailyReturn });
  });
}

function indexAt(index: readonly TwrIndexPoint[], date: IsoDate): Decimal {
  let found = new Decimal(1);
  for (const point of index) {
    if (point.date > date) break;
    found = point.index;
  }
  return found;
}

/** Return between the close of `from` and the close of `to`: I(to) / I(from) − 1. */
export function periodReturn(index: readonly TwrIndexPoint[], from: IsoDate, to: IsoDate): number {
  if (isoDate(from) > isoDate(to)) series("Period start after its end");
  return ratio(indexAt(index, to).div(indexAt(index, from)).minus(1));
}

/** (1 + r)^(365 / days) − 1, pure; the ≥ 365-day display rule is applied by the callers. */
export function annualizeReturn(r: number | Decimal, days: number): number {
  const growth = new Decimal(r).plus(1);
  if (!Number.isInteger(days) || days <= 0 || growth.isNegative() || !growth.isFinite()) {
    series("Annualization needs positive days and a return ≥ −100 %");
  }
  return ratio(growth.pow(new Decimal(365).div(days)).minus(1));
}

export interface TwrResult {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly twr: number;
  /** Calendar days from the later of `from` and the first point to `to` (vector B: 364). */
  readonly days: number;
  /** Only for periods of at least 365 days (§ 6.2); shorter periods show the cumulative value. */
  readonly annualized: number | null;
}

/** TWR for a period; by default from the first point (inception) to the last one. */
export function timeWeightedReturn(
  points: readonly PerformancePoint[],
  options: { readonly from?: IsoDate | undefined; readonly to?: IsoDate | undefined } = {},
): TwrResult {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) series("TWR needs at least one point");
  const index = twrIndex(points);
  const from = options.from ?? addDays(first.date, -1);
  const to = options.to ?? last.date;
  const twr = periodReturn(index, from, to);
  const days = daysBetween(from < first.date ? first.date : from, to);
  return Object.freeze({
    from,
    to,
    twr,
    days,
    annualized: days >= 365 ? annualizeReturn(twr, days) : null,
  });
}

/** Simple return (§ 6.1, auxiliary only): (V_end − V_start − ΣF) / V_start; null if V_start ≤ 0. */
export function simpleReturn(start: Money, end: Money, flows: Money): number | null {
  assertSameCurrency(start.currency, end.currency);
  assertSameCurrency(start.currency, flows.currency);
  if (!start.amount.isPositive() || start.amount.isZero()) return null;
  return ratio(end.amount.minus(start.amount).minus(flows.amount).div(start.amount));
}

export const PERIOD_KEYS = ["1m", "3m", "6m", "ytd", "1y", "3y", "5y", "inception"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

const PERIOD_MONTHS: Readonly<Record<string, number>> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "3y": 36,
  "5y": 60,
};

/**
 * Base day of a period (`Performance.periods[].key` in the API): the return runs from the close
 * of this day to the close of `end`. Never earlier than the day before the first valuation.
 */
export function periodStart(key: PeriodKey, end: IsoDate, inception: IsoDate): IsoDate {
  const floor = addDays(inception, -1);
  let start: IsoDate;
  if (key === "inception") start = floor;
  else if (key === "ytd") start = isoDate(`${Number(end.slice(0, 4)) - 1}-12-31`);
  else if (Object.hasOwn(PERIOD_MONTHS, key))
    start = addMonths(end, -(PERIOD_MONTHS[key] as number));
  else series(`Unknown period ${String(key)}`);
  return start < floor ? floor : start;
}

export interface DatedAmount {
  readonly date: IsoDate;
  readonly amount: Money;
}

export type XirrStatus = "ok" | "no_convergence" | "insufficient_flows" | "period_too_short";

export interface XirrResult {
  readonly rate: number | null;
  readonly status: XirrStatus;
}

export interface XirrOptions {
  readonly guess?: number | undefined;
  readonly maxIterations?: number | undefined;
  /** Periods shorter than this are not shown (unstable, § 6.3). */
  readonly minDays?: number | undefined;
}

export const XIRR_MIN_DAYS = 30;
const TOLERANCE = new Decimal("1e-12");
const LOWER = new Decimal("-0.9999");
const UPPER = new Decimal(10);

/**
 * XIRR (§ 6.3): Σ CF_k / (1 + x)^((t_k − t_0)/365) = 0, investor view (deposits −, withdrawals and
 * end value +). Newton–Raphson from 0.1 (100 iterations, 1e-12), then bisection on [−0.9999; 10].
 */
export function xirr(cashflows: readonly DatedAmount[], options: XirrOptions = {}): XirrResult {
  const currency = cashflows[0]?.amount.currency;
  for (const flow of cashflows) assertSameCurrency(currency as string, flow.amount.currency);
  const hasPositive = cashflows.some(
    (f) => f.amount.amount.isPositive() && !f.amount.amount.isZero(),
  );
  const hasNegative = cashflows.some(
    (f) => f.amount.amount.isNegative() && !f.amount.amount.isZero(),
  );
  if (!hasPositive || !hasNegative) return { rate: null, status: "insufficient_flows" };
  const dates = cashflows.map((f) => isoDate(f.date)).sort();
  const t0 = dates[0] as IsoDate;
  if (daysBetween(t0, dates.at(-1) as IsoDate) < (options.minDays ?? XIRR_MIN_DAYS)) {
    return { rate: null, status: "period_too_short" };
  }
  const terms = cashflows.map((f) => ({
    amount: f.amount.amount,
    exponent: new Decimal(daysBetween(t0, f.date)).div(365),
  }));
  const npv = (x: Decimal) =>
    terms.reduce((sum, t) => sum.plus(t.amount.div(x.plus(1).pow(t.exponent))), new Decimal(0));
  const slope = (x: Decimal) =>
    terms.reduce(
      (sum, t) => sum.minus(t.exponent.times(t.amount).div(x.plus(1).pow(t.exponent.plus(1)))),
      new Decimal(0),
    );

  let x = new Decimal(options.guess ?? 0.1);
  for (let i = 0; i < (options.maxIterations ?? 100); i += 1) {
    if (!x.plus(1).isPositive() || x.plus(1).isZero()) break;
    const derivative = slope(x);
    if (derivative.isZero()) break;
    const next = x.minus(npv(x).div(derivative));
    if (!next.isFinite()) break;
    if (next.minus(x).abs().lessThan(TOLERANCE) && next.plus(1).isPositive()) {
      return { rate: ratio(next), status: "ok" };
    }
    x = next;
  }

  let low = LOWER;
  let high = UPPER;
  let fLow = npv(low);
  const fHigh = npv(high);
  if (fLow.isZero()) return { rate: ratio(low), status: "ok" };
  if (fHigh.isZero()) return { rate: ratio(high), status: "ok" };
  if (fLow.isNegative() === fHigh.isNegative()) return { rate: null, status: "no_convergence" };
  while (high.minus(low).greaterThan(TOLERANCE)) {
    const middle = low.plus(high).div(2);
    const fMiddle = npv(middle);
    if (fMiddle.isZero()) return { rate: ratio(middle), status: "ok" };
    if (fMiddle.isNegative() === fLow.isNegative()) {
      low = middle;
      fLow = fMiddle;
    } else high = middle;
  }
  return { rate: ratio(low.plus(high).div(2)), status: "ok" };
}

/**
 * Investor-view cash flows for XIRR (§ 0.4, § 6.3): the start value enters as a deposit at t_0,
 * portfolio flows change sign, the end value is a final inflow.
 */
export function investorCashflows(input: {
  readonly start: { readonly date: IsoDate; readonly value: Money };
  readonly flows: readonly DatedAmount[];
  readonly end: { readonly date: IsoDate; readonly value: Money };
}): DatedAmount[] {
  const result: DatedAmount[] = [];
  if (!input.start.value.amount.isZero()) {
    result.push({
      date: input.start.date,
      amount: money(input.start.value.amount.negated(), input.start.value.currency),
    });
  }
  const flows = [...input.flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const flow of flows) {
    result.push({
      date: flow.date,
      amount: money(flow.amount.amount.negated(), flow.amount.currency),
    });
  }
  result.push({ date: input.end.date, amount: input.end.value });
  return result;
}
