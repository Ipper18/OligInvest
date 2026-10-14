import { addMoney, assertSameCurrency, type Money, subtractMoney, sumMoney } from "./money.js";

/** FR-02.09, obliczenia-finansowe § 5.1. Inputs are economic amounts in reporting currency. */
export function dayContributions(input: {
  base: Money | null;
  totalChange: Money | null;
  positions: readonly {
    instrumentId: string;
    previousValue: Money | null;
    currentValue: Money | null;
    cash: Money | null;
    transfers: Money | null;
  }[];
}) {
  const positions = input.positions.map((p) => {
    const change =
      p.previousValue && p.currentValue && p.cash && p.transfers
        ? subtractMoney(
            addMoney(subtractMoney(p.currentValue, p.previousValue), p.cash),
            p.transfers,
          )
        : null;
    if (change && input.base) assertSameCurrency(change.currency, input.base.currency);
    return {
      instrumentId: p.instrumentId,
      change,
      contributionRatio:
        change && input.base?.amount.gt(0) ? change.amount.div(input.base.amount).toNumber() : null,
    };
  });
  return {
    positions,
    residualChange:
      input.totalChange && positions.every((p) => p.change !== null)
        ? subtractMoney(
            input.totalChange,
            sumMoney(
              positions.map((p) => p.change!),
              input.totalChange.currency,
            ),
          )
        : null,
  };
}
