import { compareIsoDates, daysBetween, type IsoDate, isoDate } from "./dates.js";
import { Decimal, toDecimal } from "./decimal.js";
import { CoreError } from "./errors.js";

/**
 * Risk-free series of § 8 (BL-319): PLN — NBP reference rate entered by the administrator as
 * dated decisions; USD — FRED DGS3MO (3-month Treasury bill, daily). Both stored in percent.
 */
export const RISK_FREE_SERIES = {
  PLN: { code: "NBP:REF_RATE", kind: "step" },
  USD: { code: "FRED:DGS3MO", kind: "daily" },
} as const;
export type RiskFreeCurrency = keyof typeof RISK_FREE_SERIES;
/** A daily series older than this is shown as stale (one week covers US holidays). */
export const RISK_FREE_MAX_AGE_DAYS = 7;

export interface MacroObservation {
  readonly date: string;
  /** Percent per year, decimal text (e.g. "5.75"). */
  readonly value: string;
}
export interface RiskFreeRate {
  readonly currency: RiskFreeCurrency;
  readonly seriesCode: string;
  /** Annual rate as a fraction (Ratio, § 0.1). */
  readonly annualRate: number;
  readonly effectiveDate: IsoDate;
  readonly stale: boolean;
}

/**
 * Rate in force on `date`: the latest observation on or before it. The NBP rate is a step
 * function (valid until the next decision); the FRED series is stale after a week without data.
 * `null` = no observation yet — never an implicit 0 % (the caller shows the missing assumption).
 */
export function riskFreeRateOn(
  currency: RiskFreeCurrency,
  observations: readonly MacroObservation[],
  date: string,
): RiskFreeRate | null {
  const day = isoDate(date);
  const series = RISK_FREE_SERIES[currency];
  let latest: { date: IsoDate; value: Decimal } | undefined;
  const seen = new Set<string>();
  for (const observation of observations) {
    const observed = isoDate(observation.date);
    if (seen.has(observed))
      throw new CoreError("invalid_series", "Duplicate observation", { date: observed });
    seen.add(observed);
    const value = toDecimal(observation.value);
    if (value.lt(-5) || value.gt(50))
      throw new CoreError("invalid_series", "Rate out of range", { date: observed });
    if (
      compareIsoDates(observed, day) <= 0 &&
      (!latest || compareIsoDates(observed, latest.date) > 0)
    )
      latest = { date: observed, value };
  }
  if (!latest) return null;
  return Object.freeze({
    currency,
    seriesCode: series.code,
    annualRate: latest.value.div(new Decimal(100)).toNumber(),
    effectiveDate: latest.date,
    stale: series.kind === "daily" && daysBetween(latest.date, day) > RISK_FREE_MAX_AGE_DAYS,
  });
}
