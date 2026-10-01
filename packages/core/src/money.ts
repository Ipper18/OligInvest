import { type CurrencyCode, currencyCode, minorUnits } from "./currency.js";
import { Decimal, type DecimalInput, roundHalfUp, toDecimal } from "./decimal.js";
import { CoreError } from "./errors.js";

declare const moneyBrand: unique symbol;
declare const quantityBrand: unique symbol;
declare const priceBrand: unique symbol;

/** Settlement amount with an explicit currency; never rounded implicitly (ADR-014). */
export interface Money {
  readonly amount: Decimal;
  readonly currency: CurrencyCode;
  readonly [moneyBrand]: true;
}

/** Number of units of an instrument; fractions allowed, never negative. */
export type Quantity = Decimal & { readonly [quantityBrand]: true };

/** Unit price in the instrument's quote currency. */
export interface Price {
  readonly amount: Decimal;
  readonly currency: CurrencyCode;
  readonly [priceBrand]: true;
}

export interface MoneyJson {
  readonly amount: string;
  readonly currency: string;
}

export function money(amount: DecimalInput, currency: string): Money {
  return Object.freeze({ amount: toDecimal(amount), currency: currencyCode(currency) }) as Money;
}

export function zeroMoney(currency: string): Money {
  return money(new Decimal(0), currency);
}

export function assertSameCurrency(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new CoreError("currency_mismatch", "Amounts in different currencies cannot be combined", {
      expected,
      actual,
    });
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a.currency, b.currency);
  return money(a.amount.plus(b.amount), a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a.currency, b.currency);
  return money(a.amount.minus(b.amount), a.currency);
}

export function negateMoney(a: Money): Money {
  return money(a.amount.negated(), a.currency);
}

export function multiplyMoney(a: Money, factor: DecimalInput): Money {
  return money(a.amount.times(toDecimal(factor)), a.currency);
}

export function divideMoney(a: Money, divisor: DecimalInput): Money {
  const d = toDecimal(divisor);
  if (d.isZero()) throw new CoreError("division_by_zero", "Cannot divide money by zero");
  return money(a.amount.div(d), a.currency);
}

/** Sums amounts that must all be in `currency`; an empty list gives zero. */
export function sumMoney(items: readonly Money[], currency: string): Money {
  let total = new Decimal(0);
  for (const item of items) {
    assertSameCurrency(currency, item.currency);
    total = total.plus(item.amount);
  }
  return money(total, currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a.currency, b.currency);
  return a.amount.comparedTo(b.amount) as -1 | 0 | 1;
}

export function isZeroMoney(a: Money): boolean {
  return a.amount.isZero();
}

export function isNegativeMoney(a: Money): boolean {
  return a.amount.isNegative() && !a.amount.isZero();
}

/** Rounds to the currency unit with ROUND_HALF_UP — only at presentation or storage boundaries. */
export function roundMoney(a: Money): Money {
  return money(roundHalfUp(a.amount, minorUnits(a.currency)), a.currency);
}

/** API representation: decimal string plus currency; optional fixed places use ROUND_HALF_UP. */
export function moneyToJson(a: Money, options: { fractionDigits?: number } = {}): MoneyJson {
  const amount =
    options.fractionDigits === undefined
      ? a.amount.toFixed()
      : roundHalfUp(a.amount, options.fractionDigits).toFixed(options.fractionDigits);
  return { amount, currency: a.currency };
}

export function moneyFromJson(json: MoneyJson): Money {
  if (json === null || typeof json !== "object") {
    throw new CoreError("invalid_decimal", "Expected a money object");
  }
  return money(json.amount, json.currency);
}

export function quantity(value: DecimalInput): Quantity {
  const q = toDecimal(value);
  if (q.isNegative() && !q.isZero()) {
    throw new CoreError("invalid_quantity", "Quantity cannot be negative");
  }
  return q as Quantity;
}

export function price(amount: DecimalInput, currency: string): Price {
  const value = toDecimal(amount);
  if (value.isNegative() && !value.isZero()) {
    throw new CoreError("invalid_price", "Price cannot be negative");
  }
  return Object.freeze({ amount: value, currency: currencyCode(currency) }) as Price;
}

/** q · p in the quote currency (value before FX and costs). */
export function grossValue(unitPrice: Price, units: Quantity): Money {
  return money(unitPrice.amount.times(units), unitPrice.currency);
}
