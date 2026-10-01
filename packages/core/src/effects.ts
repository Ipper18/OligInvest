import { CoreError } from "./errors.js";
import { assertSameCurrency, type Money, money, subtractMoney } from "./money.js";

export interface PriceFxEffectInput {
  /** Cost in the account (reporting) currency, e.g. PLN. */
  readonly cost: Money;
  /** K_i: the same cost in the instrument currency. */
  readonly costInstrument: Money;
  /** Market value (unrealized) or net proceeds (realized) in the account currency. */
  readonly value: Money;
  /** The same value in the instrument currency. */
  readonly valueInstrument: Money;
}

export interface PriceFxEffect {
  readonly pl: Money;
  readonly priceEffect: Money;
  readonly fxEffect: Money;
}

/**
 * Price and FX effect (obliczenia-finansowe.md § 4.2) with the effective purchase rate
 * r_0 = cost / K_i: price effect = (value_i − K_i)·r_0, FX effect = P/L − price effect (identity).
 */
export function priceFxEffect(input: PriceFxEffectInput): PriceFxEffect {
  assertSameCurrency(input.cost.currency, input.value.currency);
  assertSameCurrency(input.costInstrument.currency, input.valueInstrument.currency);
  if (input.costInstrument.amount.isZero()) {
    throw new CoreError("division_by_zero", "Cost in the instrument currency is zero");
  }
  const r0 = input.cost.amount.div(input.costInstrument.amount);
  const pl = subtractMoney(input.value, input.cost);
  const priceEffect = money(
    input.valueInstrument.amount.minus(input.costInstrument.amount).times(r0),
    input.cost.currency,
  );
  return Object.freeze({ pl, priceEffect, fxEffect: subtractMoney(pl, priceEffect) });
}
