/** Stable error codes; callers map them to problem+json (e.g. `short_position` → import row error). */
export type CoreErrorCode =
  | "invalid_decimal"
  | "invalid_currency"
  | "currency_mismatch"
  | "division_by_zero"
  | "invalid_quantity"
  | "invalid_price"
  | "invalid_fx_rate"
  | "duplicate_fx_rate"
  | "invalid_date"
  | "invalid_settlement"
  | "invalid_format"
  | "invalid_account"
  | "invalid_transaction"
  | "short_position"
  | "unmatched_security_transfer"
  | "invalid_series";

export type CoreErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly details: CoreErrorDetails;

  constructor(code: CoreErrorCode, message: string, details: CoreErrorDetails = {}) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError;
}
