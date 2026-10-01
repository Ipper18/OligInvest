import { CoreError } from "./errors.js";

declare const currencyBrand: unique symbol;
/** ISO 4217 code validated against the platform's Intl currency list. */
export type CurrencyCode = string & { readonly [currencyBrand]: true };

const SUPPORTED = new Set(Intl.supportedValuesOf("currency"));
const MINOR_UNITS = new Map<string, number>();

export function currencyCode(code: string): CurrencyCode {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code) || !SUPPORTED.has(code)) {
    throw new CoreError("invalid_currency", "Expected an ISO 4217 currency code", {
      code: typeof code === "string" ? code : typeof code,
    });
  }
  return code as CurrencyCode;
}

export const PLN = currencyCode("PLN");
export const USD = currencyCode("USD");
export const EUR = currencyCode("EUR");

/** Digits of the currency unit (PLN, USD, EUR: 2) from ISO 4217 data shipped with Intl. */
export function minorUnits(currency: CurrencyCode): number {
  let digits = MINOR_UNITS.get(currency);
  if (digits === undefined) {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits as number;
    MINOR_UNITS.set(currency, digits);
  }
  return digits;
}
