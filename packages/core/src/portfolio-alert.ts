import { Decimal, toDecimal } from "./decimal.js";
import type { PriceAlertState } from "./price-alert.js";

export function allocationDrift(
  total: string,
  targets: readonly { key: string; weight: string }[],
  amounts: ReadonlyMap<string, string>,
) {
  const base = toDecimal(total);
  if (base.lte(0) || targets.length === 0) return null;
  const deviations = targets.map(({ key, weight }) =>
    toDecimal(amounts.get(key) ?? "0")
      .div(base)
      .minus(weight)
      .abs(),
  );
  return Decimal.max(...deviations).toFixed();
}

export function evaluatePortfolioAlert(
  metric: string | null,
  threshold: string,
  hysteresis: string,
  cooldownMinutes: number,
  asOf: string,
  previous?: PriceAlertState,
) {
  if (metric === null || (previous && Date.parse(asOf) <= Date.parse(previous.asOf)))
    return { triggered: false, state: previous };
  const magnitude = toDecimal(metric).abs();
  const limit = toDecimal(threshold);
  const state: PriceAlertState = {
    ...previous,
    armed: previous?.armed ?? true,
    asOf,
    sessionDate: asOf.slice(0, 10),
  };
  if (magnitude.lte(Decimal.max(0, limit.minus(hysteresis)))) state.armed = true;
  const triggered =
    state.armed &&
    magnitude.gt(limit) &&
    (!state.lastTriggeredAt ||
      Date.parse(asOf) - Date.parse(state.lastTriggeredAt) >= cooldownMinutes * 60000);
  if (triggered) {
    state.armed = false;
    state.lastTriggeredAt = asOf;
  }
  return { triggered, state };
}
