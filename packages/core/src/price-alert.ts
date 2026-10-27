import { Decimal, toDecimal } from "./decimal.js";

export type PriceAlertRule = {
  type: "price_above" | "price_below" | "change_pct";
  threshold: string;
  hysteresis: string;
  cooldownMinutes: number;
  direction?: "up" | "down" | "both";
};
export type PriceAlertState = {
  armed: boolean;
  asOf: string;
  sessionDate: string;
  lastTriggeredAt?: string | undefined;
};
export type PriceAlertObservation = {
  price: string;
  previousClose?: string;
  asOf: string;
  sessionDate: string;
  stale: boolean;
  blocked: boolean;
};

/** OBL §16. Unusable/older observations must not change the state machine. */
export function evaluatePriceAlert(
  rule: PriceAlertRule,
  observation: PriceAlertObservation,
  previous?: PriceAlertState,
): { triggered: boolean; state: PriceAlertState | undefined; value?: string } {
  const unchanged = { triggered: false, state: previous };
  if (
    observation.stale ||
    observation.blocked ||
    (previous && Date.parse(observation.asOf) <= Date.parse(previous.asOf))
  )
    return unchanged;
  let value = toDecimal(observation.price);
  const threshold = toDecimal(rule.threshold),
    h = toDecimal(rule.hysteresis);
  if (rule.type === "change_pct") {
    if (!observation.previousClose || toDecimal(observation.previousClose).lte(0)) return unchanged;
    value = value.div(toDecimal(observation.previousClose)).minus(1);
  }
  const direction = rule.direction ?? "both";
  const metric =
    rule.type !== "change_pct" || direction === "up"
      ? value
      : direction === "down"
        ? value.negated()
        : value.abs();
  const above = rule.type !== "price_below";
  const matches = above ? metric.gt(threshold) : metric.lt(threshold);
  const reset =
    rule.type === "change_pct"
      ? metric.lte(Decimal.max(0, threshold.minus(h)))
      : above
        ? metric.lte(threshold.mul(new Decimal(1).minus(h)))
        : metric.gte(threshold.mul(new Decimal(1).plus(h)));
  const state: PriceAlertState = {
    ...previous,
    asOf: observation.asOf,
    sessionDate: observation.sessionDate,
    armed: previous?.armed ?? true,
  };
  if (reset || (rule.type === "change_pct" && previous?.sessionDate !== observation.sessionDate))
    state.armed = true;
  const cooled =
    !state.lastTriggeredAt ||
    Date.parse(observation.asOf) - Date.parse(state.lastTriggeredAt) >=
      rule.cooldownMinutes * 60_000;
  const triggered = state.armed && matches && cooled;
  if (triggered) {
    state.armed = false;
    state.lastTriggeredAt = observation.asOf;
  }
  return { triggered, state, value: value.toFixed() };
}
