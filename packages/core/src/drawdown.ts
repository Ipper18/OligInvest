import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";

export interface DrawdownResult {
  /** DD(t) = V*(t) / max_{s ≤ t} V*(s) − 1 (underwater series, fractions). */
  readonly series: readonly number[];
  /** min_t DD(t); 0 when the index never falls. */
  readonly maxDrawdown: number;
  /** Peak before the deepest trough; the trough; the first return to that peak (null: not yet). */
  readonly peakIndex: number | null;
  readonly troughIndex: number | null;
  readonly recoveryIndex: number | null;
}

/**
 * Drawdowns (obliczenia-finansowe.md § 7) on the TWR index V* (flow-adjusted), never on raw values —
 * otherwise a withdrawal would look like a loss. Indices point into `values`.
 */
export function drawdowns(values: readonly Decimal[]): DrawdownResult {
  const series: number[] = [];
  let peak = new Decimal(0);
  let peakAt = -1;
  let worst = new Decimal(0);
  let peakIndex: number | null = null;
  let troughIndex: number | null = null;
  values.forEach((value, i) => {
    if (!Decimal.isDecimal(value) || !value.isFinite() || !value.isPositive() || value.isZero()) {
      throw new CoreError("invalid_series", "Index values must be positive Decimals", { index: i });
    }
    // Equal highs move the peak to the latest one, as in empyrical (C-22).
    if (value.greaterThanOrEqualTo(peak)) {
      peak = value;
      peakAt = i;
    }
    const dd = value.div(peak).minus(1);
    series.push(dd.isZero() ? 0 : dd.toNumber());
    if (dd.lessThan(worst)) {
      worst = dd;
      peakIndex = peakAt;
      troughIndex = i;
    }
  });
  let recoveryIndex: number | null = null;
  if (troughIndex !== null && peakIndex !== null) {
    const level = values[peakIndex] as Decimal;
    for (let i = troughIndex + 1; i < values.length; i += 1) {
      if ((values[i] as Decimal).greaterThanOrEqualTo(level)) {
        recoveryIndex = i;
        break;
      }
    }
  }
  return Object.freeze({
    series: Object.freeze(series),
    maxDrawdown: worst.isZero() ? 0 : worst.toNumber(),
    peakIndex,
    troughIndex,
    recoveryIndex,
  });
}
