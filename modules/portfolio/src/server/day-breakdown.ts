import {
  addMoney,
  convertMoney,
  dayContributions,
  externalFlows,
  type FxRateTable,
  grossValue,
  type IsoDate,
  isCoreError,
  type Money,
  type PortfolioValuation,
  type Quote,
  sumMoney,
  type Transaction,
} from "@oliginvest/core";

export function dayInstrument(
  t: Transaction,
  transactions: readonly Transaction[],
): string | undefined {
  if ("instrumentId" in t) return t.instrumentId;
  if (t.type !== "FEE" && t.type !== "TAX") return undefined;
  const parent = transactions.find((p) => p.id === t.relatedTransactionId);
  return parent && "instrumentId" in parent ? parent.instrumentId : undefined;
}

export function projectDayBreakdown(input: {
  previous: PortfolioValuation;
  current: PortfolioValuation;
  transactions: Transaction[];
  quotes: Quote[];
  fx: FxRateTable;
  date: IsoDate;
  flows: Money | null;
  change: Money | null;
}) {
  const today = input.transactions.filter((t) => t.tradeDate === input.date);
  const instrumentFor = (t: Transaction) => dayInstrument(t, input.transactions);
  const instrumentIds = new Set([
    ...input.previous.accounts.flatMap((a) => a.positions.map((p) => p.instrumentId)),
    ...input.current.accounts.flatMap((a) => a.positions.map((p) => p.instrumentId)),
    ...today.flatMap((t) => (instrumentFor(t) ? [instrumentFor(t)!] : [])),
  ]);
  const base = (value: Money) => {
    if (value.amount.isZero()) return sumMoney([], "PLN");
    const rate = input.fx.onOrBefore(value.currency, "PLN", input.date);
    return rate ? convertMoney(value, rate) : null;
  };
  const sum = (values: (Money | null)[]) =>
    values.every((v) => v !== null) ? sumMoney(values, "PLN") : null;
  const value = (valuation: PortfolioValuation, id: string) =>
    sum(
      valuation.accounts.flatMap((a) =>
        a.positions
          .filter((p) => p.instrumentId === id)
          .map((p) => (p.marketValue && a.fxRate ? convertMoney(p.marketValue, a.fxRate) : null)),
      ),
    );
  return dayContributions({
    base:
      input.previous.isComplete && input.flows ? addMoney(input.previous.total, input.flows) : null,
    totalChange: input.change,
    positions: [...instrumentIds].map((instrumentId) => {
      const transactions = today.filter((t) => instrumentFor(t) === instrumentId);
      let transfers: Money | null;
      try {
        transfers = sum(
          externalFlows(transactions, {
            level: "portfolio",
            securityTransferValue: (t) => {
              if (!("quantity" in t)) return undefined;
              const quote = input.quotes.find((q) => q.instrumentId === instrumentId);
              return quote ? grossValue(quote.price, t.quantity) : undefined;
            },
          }).map((f) => base(f.amount)),
        );
      } catch (error) {
        if (!isCoreError(error) || error.code !== "missing_transfer_value") throw error;
        transfers = null;
      }
      return {
        instrumentId,
        previousValue: value(input.previous, instrumentId),
        currentValue: value(input.current, instrumentId),
        cash: sum(
          transactions.flatMap((t) =>
            "amount" in t
              ? [base(t.amount)]
              : t.type === "SPLIT" && t.cashInLieu
                ? [base(t.cashInLieu)]
                : [],
          ),
        ),
        transfers,
      };
    }),
  });
}
