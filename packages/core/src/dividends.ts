import { PLN } from "./currency.js";
import { addMonths, type IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { FxRate } from "./fx.js";
import type { DividendRecord } from "./ledger.js";
import { assertSameCurrency, type Money, money, zeroMoney } from "./money.js";

/** Flat PIT rate on dividends and capital gains (ustawa o PIT, art. 30a–30b; 11-zgodnosc-prawna.md § 5). */
export const PIT_CAPITAL_RATE = new Decimal("0.19");

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
  assertSameCurrency(cost.currency, grossDividends.currency);
  if (!cost.amount.isPositive() || cost.amount.isZero()) return null;
  return grossDividends.amount.div(cost.amount).toNumber();
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
