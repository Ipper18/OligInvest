import { Decimal, type DecimalInput, toDecimal } from "./decimal.js";
import { CoreError } from "./errors.js";

/**
 * Technical indicators (obliczenia-finansowe.md § 9) matching TA-Lib 0.8.0 in its default mode:
 * same warm-up (`null` at the start) and values within 1e-8. Prices come in as Decimals and are
 * computed exactly; results are float64 statistics (§ 0.1). Use full, split-adjusted series.
 */
export type IndicatorSeries = (number | null)[];

type Slot = Decimal | null;

function fail(message: string): never {
  throw new CoreError("invalid_series", message);
}

function checkPeriod(n: number, name = "period"): void {
  if (!Number.isInteger(n) || n < 1) fail(`${name} must be a positive integer`);
}

function checkValues(values: readonly Decimal[]): void {
  for (const value of values) {
    if (!Decimal.isDecimal(value) || !value.isFinite())
      fail("Series values must be finite Decimals");
  }
}

const out = (slots: readonly Slot[]): IndicatorSeries =>
  slots.map((v) => (v === null ? null : v.isZero() ? 0 : v.toNumber()));

function smaSlots(values: readonly Slot[], n: number): Slot[] {
  const result: Slot[] = values.map(() => null);
  for (let i = n - 1; i < values.length; i += 1) {
    const window = values.slice(i - n + 1, i + 1);
    if (window.includes(null)) continue;
    result[i] = (window as Decimal[]).reduce((sum, v) => sum.plus(v), new Decimal(0)).div(n);
  }
  return result;
}

/** EMA with α = 2/(n+1) seeded with the SMA of `values[seedStart … seedStart+n−1]`. */
function emaSlots(values: readonly Slot[], n: number, seedStart: number): Slot[] {
  const result: Slot[] = values.map(() => null);
  const seedEnd = seedStart + n - 1;
  if (seedEnd >= values.length) return result;
  const seed = values.slice(seedStart, seedEnd + 1) as Decimal[];
  const alpha = new Decimal(2).div(n + 1);
  let previous = seed.reduce((sum, v) => sum.plus(v), new Decimal(0)).div(n);
  result[seedEnd] = previous;
  for (let i = seedEnd + 1; i < values.length; i += 1) {
    previous = (values[i] as Decimal).minus(previous).times(alpha).plus(previous);
    result[i] = previous;
  }
  return result;
}

export function sma(values: readonly Decimal[], n: number): IndicatorSeries {
  checkPeriod(n);
  checkValues(values);
  return out(smaSlots(values, n));
}

export function ema(values: readonly Decimal[], n: number): IndicatorSeries {
  checkPeriod(n);
  checkValues(values);
  return out(emaSlots(values, n, 0));
}

/** RSI with Wilder smoothing; `100·avgGain / (avgGain + avgLoss)`, 0 when nothing moved (TA-Lib). */
export function rsi(values: readonly Decimal[], n: number): IndicatorSeries {
  checkPeriod(n);
  checkValues(values);
  const result: Slot[] = values.map(() => null);
  if (values.length <= n) return out(result);
  let gain = new Decimal(0);
  let loss = new Decimal(0);
  const move = (i: number) => (values[i] as Decimal).minus(values[i - 1] as Decimal);
  for (let i = 1; i <= n; i += 1) {
    const change = move(i);
    if (change.isPositive()) gain = gain.plus(change);
    else loss = loss.minus(change);
  }
  gain = gain.div(n);
  loss = loss.div(n);
  const value = () => {
    const total = gain.plus(loss);
    return total.isZero() ? new Decimal(0) : gain.div(total).times(100);
  };
  result[n] = value();
  for (let i = n + 1; i < values.length; i += 1) {
    const change = move(i);
    const up = change.isPositive() ? change : new Decimal(0);
    const down = change.isNegative() ? change.negated() : new Decimal(0);
    gain = gain
      .times(n - 1)
      .plus(up)
      .div(n);
    loss = loss
      .times(n - 1)
      .plus(down)
      .div(n);
    result[i] = value();
  }
  return out(result);
}

export interface MacdResult {
  readonly macd: IndicatorSeries;
  readonly signal: IndicatorSeries;
  readonly histogram: IndicatorSeries;
}

/**
 * MACD = EMA_fast − EMA_slow, signal = EMA_signal(MACD), histogram = MACD − signal. As in TA-Lib,
 * the fast EMA is seeded so that it starts with the slow one (index slow − 1) and all three series
 * start at index slow − 1 + signal − 1.
 */
export function macd(
  values: readonly Decimal[],
  fast: number,
  slow: number,
  signal: number,
): MacdResult {
  checkPeriod(fast, "fast");
  checkPeriod(slow, "slow");
  checkPeriod(signal, "signal");
  if (fast >= slow) fail("fast period must be shorter than slow period");
  checkValues(values);
  const first = slow - 1 + signal - 1;
  const fastEma = emaSlots(values, fast, slow - fast);
  const slowEma = emaSlots(values, slow, 0);
  const line: Slot[] = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f && s ? f.minus(s) : null;
  });
  const signalLine = emaSlots(line, signal, slow - 1);
  const visible = (slots: readonly Slot[]) => slots.map((v, i) => (i < first ? null : v));
  const histogram = line.map((v, i) => {
    const s = signalLine[i];
    return v && s ? v.minus(s) : null;
  });
  return Object.freeze({
    macd: out(visible(line)),
    signal: out(visible(signalLine)),
    histogram: out(visible(histogram)),
  });
}

export interface BollingerResult {
  readonly upper: IndicatorSeries;
  readonly middle: IndicatorSeries;
  readonly lower: IndicatorSeries;
}

/** Bollinger bands: SMA(n) ± k·σ with the population standard deviation (divisor n). */
export function bollingerBands(
  values: readonly Decimal[],
  n: number,
  k: DecimalInput,
): BollingerResult {
  checkPeriod(n);
  checkValues(values);
  const width = toDecimal(k);
  if (width.isNegative()) fail("k must not be negative");
  const middle = smaSlots(values, n);
  const upper: Slot[] = values.map(() => null);
  const lower: Slot[] = values.map(() => null);
  middle.forEach((mean, i) => {
    if (mean === null) return;
    const window = values.slice(i - n + 1, i + 1);
    const variance = window
      .reduce((sum, v) => sum.plus(v.minus(mean).pow(2)), new Decimal(0))
      .div(n);
    const band = variance.sqrt().times(width);
    upper[i] = mean.plus(band);
    lower[i] = mean.minus(band);
  });
  return Object.freeze({ upper: out(upper), middle: out(middle), lower: out(lower) });
}

/** ATR: TR from index 1, first value = mean of the first n TRs (index n), then Wilder smoothing. */
export function atr(
  high: readonly Decimal[],
  low: readonly Decimal[],
  close: readonly Decimal[],
  n: number,
): IndicatorSeries {
  checkPeriod(n);
  if (high.length !== close.length || low.length !== close.length) {
    fail("high, low and close must have the same length");
  }
  for (const series of [high, low, close]) checkValues(series);
  const result: Slot[] = close.map(() => null);
  if (close.length <= n) return out(result);
  const trueRange = (i: number) => {
    const h = high[i] as Decimal;
    const l = low[i] as Decimal;
    const previous = close[i - 1] as Decimal;
    return Decimal.max(h.minus(l), h.minus(previous).abs(), l.minus(previous).abs());
  };
  let value = new Decimal(0);
  for (let i = 1; i <= n; i += 1) value = value.plus(trueRange(i));
  value = value.div(n);
  result[n] = value;
  for (let i = n + 1; i < close.length; i += 1) {
    value = value
      .times(n - 1)
      .plus(trueRange(i))
      .div(n);
    result[i] = value;
  }
  return out(result);
}
