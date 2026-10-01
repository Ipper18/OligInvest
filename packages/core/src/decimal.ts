import { Decimal as DecimalJs } from "decimal.js";
import { CoreError } from "./errors.js";

/**
 * Isolated decimal.js constructor (obliczenia-finansowe.md § 0.2): 34 significant digits,
 * ROUND_HALF_EVEN in computations, never exponent notation. The global decimal.js config is untouched.
 */
export const Decimal = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});
export type Decimal = DecimalJs;

/** Exact inputs only: a Decimal or strict decimal text. JS numbers are rejected at runtime. */
export type DecimalInput = Decimal | string;

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

export function toDecimal(input: DecimalInput): Decimal {
  if (DecimalJs.isDecimal(input)) {
    if (!input.isFinite()) throw new CoreError("invalid_decimal", "Decimal must be finite");
    return new Decimal(input);
  }
  if (typeof input !== "string" || !DECIMAL_TEXT.test(input)) {
    throw new CoreError(
      "invalid_decimal",
      "Expected decimal text or Decimal; floats are forbidden",
      {
        type: typeof input,
      },
    );
  }
  return new Decimal(input);
}

/** Presentation and storage rounding (ROUND_HALF_UP, ties away from zero). */
export function roundHalfUp(value: Decimal, fractionDigits: number): Decimal {
  return value.toDecimalPlaces(fractionDigits, Decimal.ROUND_HALF_UP);
}
