import { PLN } from "./currency.js";
import { addMonths, type IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { FxRate } from "./fx.js";
import type { DividendRecord } from "./ledger.js";
import { assertSameCurrency, type Money, money, zeroMoney } from "./money.js";

/** Flat PIT rate on dividends and capital gains (ustawa o PIT, art. 30a–30b; 11-zgodnosc-prawna.md § 5). */
export const PIT_CAPITAL_RATE: Decimal = new Decimal("0.19");

/** Informational tax view of one dividend (obliczenia-finansowe.md § 4.3); amounts unrounded. */
export interface DividendTaxView {
  readonly taxDate: IsoDate;
  /** Date of the NBP table used (null for a dividend in PLN). */
  readonly rateDate: IsoDate | null;
  readonly grossPln: Money;
  /** 19 % of the gross amount in PLN. */
  readonly taxDuePln: Money;
  /** Withholding tax in PLN credited against the Polish tax — at most `taxDuePln` (top-up to 19 %). */
  readonly withholdingCreditPln: Money;
  /** Estimated top-up: `taxDuePln − withholdingCreditPln`, never negative. */
  readonly topUpPln: Money;
}

export interface DividendTaxInput {
  readonly gross: Money;
  readonly withholdingTax?: Money | undefined;
  /** Day of income (payment date); the rate is NBP from the business day before it. */
  readonly taxDate: IsoDate;
  /** `gross.currency` → PLN, required unless the dividend is paid in PLN. */
  readonly rate?: FxRate | undefined;
}

export function dividendTaxView(input: DividendTaxInput): DividendTaxView {
  const wht = input.withholdingTax ?? zeroMoney(input.gross.currency);
  assertSameCurrency(input.gross.currency, wht.currency);
  let factor = new Decimal(1);
  if (input.gross.currency !== PLN) {
    const rate = input.rate;
    if (!rate || rate.base !== input.gross.currency || rate.quote !== PLN) {
      throw new CoreError("invalid_fx_rate", "Dividend tax view needs a rate to PLN", {
        currency: input.gross.currency,
      });
    }
    factor = rate.rate;
  }
  const grossPln = input.gross.amount.times(factor);
  const taxDue = grossPln.times(PIT_CAPITAL_RATE);
  const credit = Decimal.min(wht.amount.times(factor), taxDue);
  return Object.freeze({
    taxDate: input.taxDate,
    rateDate: input.gross.currency === PLN ? null : (input.rate?.date ?? null),
    grossPln: money(grossPln, PLN),
    taxDuePln: money(taxDue, PLN),
    withholdingCreditPln: money(credit, PLN),
    topUpPln: money(taxDue.minus(credit), PLN),
  });
}

/** Dividends paid in the 12 months up to and including `asOf` (optionally one account/instrument). */
export function trailingDividends(
  records: readonly DividendRecord[],
  filter: { readonly asOf: IsoDate; readonly accountId?: string; readonly instrumentId?: string },
): DividendRecord[] {
  const from = addMonths(filter.asOf, -12);
  return records.filter(
    (r) =>
      r.paymentDate > from &&
      r.paymentDate <= filter.asOf &&
      (filter.accountId === undefined || r.accountId === filter.accountId) &&
      (filter.instrumentId === undefined || r.instrumentId === filter.instrumentId),
  );
}

/**
 * Yield on cost (§ 4.3): gross dividends of the trailing 12 months / cost of the position, in one
 * currency chosen by the caller; null when the cost is not positive.
 */
export function yieldOnCost(grossDividends: Money, cost: Money): number | null {
  return yieldOnCostRatio(grossDividends, cost)?.toNumber() ?? null;
}

/** As `yieldOnCost`, unrounded, for decimal-string API fields (BL-307). */
export function yieldOnCostRatio(grossDividends: Money, cost: Money): Decimal | null {
  assertSameCurrency(cost.currency, grossDividends.currency);
  if (!cost.amount.isPositive() || cost.amount.isZero()) return null;
  return grossDividends.amount.div(cost.amount);
}

/**
 * Yield on cost in PLN (owner decision 2026-09-24): gross dividends converted at NBP D-1 as in the
 * tax view (`DividendRecord.grossPln`) over the position cost in PLN; null if a rate is missing.
 */
export function yieldOnCostPln(records: readonly DividendRecord[], costPln: Money): number | null {
  assertSameCurrency(PLN, costPln.currency);
  const gross = records.map((r) => r.grossPln);
  if (gross.includes(null)) return null;
  return yieldOnCost(
    money(
      (gross as Money[]).reduce((sum, m) => sum.plus(m.amount), new Decimal(0)),
      PLN,
    ),
    costPln,
  );
}

/** Why a PLN amount of a dividend is unknown (BL-307); the amount is then null, never 0. */
export type DividendGap = "missing_fx" | "missing_withholding";
export type DividendTaxEstimateStatus =
  | "computed"
  | "not_applicable"
  | "missing_fx"
  | "missing_withholding";

/** One dividend in PLN at NBP D-1 (§ 4.3) with the informational top-up estimate; unrounded. */
export interface DividendPlnView {
  readonly grossPln: Money | null;
  readonly withholdingTaxPln: Money | null;
  readonly netPln: Money | null;
  readonly taxStatus: DividendTaxEstimateStatus;
  /** 19 % of the gross in PLN, the withholding credited up to it, and the estimated top-up. */
  readonly taxDuePln: Money | null;
  readonly withholdingCreditPln: Money | null;
  readonly topUpPln: Money | null;
  readonly gaps: readonly DividendGap[];
}

/**
 * PLN view of a ledger dividend (BL-307, FR-02.08). Gross, withholding and net use the same NBP
 * rate as the tax view on any account type. A withholding tax that is not recorded leaves the
 * withholding, net and top-up unknown — an assumed 0 would overstate the estimated top-up.
 * IKE/IKZE: the top-up does not apply (status `not_applicable`, amounts null).
 */
export function dividendPlnView(record: DividendRecord): DividendPlnView {
  const factor =
    record.gross.currency === PLN
      ? new Decimal(1)
      : record.grossPln
        ? record.rate?.rate
        : undefined;
  const gaps: DividendGap[] = [];
  if (factor === undefined) gaps.push("missing_fx");
  if (!record.withholdingRecorded) gaps.push("missing_withholding");
  const grossPln = factor === undefined ? null : money(record.gross.amount.times(factor), PLN);
  const withholdingTaxPln =
    factor === undefined || !record.withholdingRecorded
      ? null
      : money(record.withholdingTax.amount.times(factor), PLN);
  const netPln =
    grossPln && withholdingTaxPln
      ? money(grossPln.amount.minus(withholdingTaxPln.amount), PLN)
      : null;
  const taxStatus: DividendTaxEstimateStatus =
    record.taxStatus === "not_applicable"
      ? "not_applicable"
      : (gaps[0] ?? (record.tax ? "computed" : "missing_fx"));
  const tax = taxStatus === "computed" ? record.tax : null;
  return Object.freeze({
    grossPln,
    withholdingTaxPln,
    netPln,
    taxStatus,
    taxDuePln: tax?.taxDuePln ?? null,
    withholdingCreditPln: tax?.withholdingCreditPln ?? null,
    topUpPln: tax?.topUpPln ?? null,
    gaps: Object.freeze(gaps),
  });
}

export interface DividendPlnTotals {
  readonly payments: number;
  readonly grossPln: Money | null;
  readonly withholdingTaxPln: Money | null;
  readonly netPln: Money | null;
  /** Σ top-up of taxable payments; null when one is unknown or none is taxable. */
  readonly topUpPln: Money | null;
  readonly taxablePayments: number;
  readonly taxExemptPayments: number;
  readonly isComplete: boolean;
}

/** Sums PLN views without intermediate rounding; any unknown addend makes the sum null. */
export function sumDividendPlnViews(views: readonly DividendPlnView[]): DividendPlnTotals {
  const sum = (values: readonly (Money | null)[]) =>
    values.includes(null)
      ? null
      : money(
          (values as Money[]).reduce((total, m) => total.plus(m.amount), new Decimal(0)),
          PLN,
        );
  const taxable = views.filter((v) => v.taxStatus !== "not_applicable");
  return Object.freeze({
    payments: views.length,
    grossPln: sum(views.map((v) => v.grossPln)),
    withholdingTaxPln: sum(views.map((v) => v.withholdingTaxPln)),
    netPln: sum(views.map((v) => v.netPln)),
    topUpPln: taxable.length ? sum(taxable.map((v) => v.topUpPln)) : null,
    taxablePayments: taxable.length,
    taxExemptPayments: views.length - taxable.length,
    isComplete: views.every((v) => v.gaps.length === 0),
  });
}
