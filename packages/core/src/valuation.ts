import { type CurrencyCode, currencyCode, PLN } from "./currency.js";
import { type IsoDate, isoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { FxRate, FxRateTable } from "./fx.js";
import type { CashBalance, Position } from "./ledger.js";
import {
  assertSameCurrency,
  type Money,
  money,
  type Price,
  type Quantity,
  subtractMoney,
  zeroMoney,
} from "./money.js";
import { sortTransactions, type Transaction } from "./transactions.js";

/** Last known price of an instrument with its timestamp (ISO 8601 instant, UTC). */
export interface Quote {
  readonly instrumentId: string;
  readonly price: Price;
  readonly asOf: string;
}

export interface ValuationInput {
  readonly accounts: readonly {
    readonly id: string;
    readonly currency: CurrencyCode;
  }[];
  readonly positions: readonly Position[];
  readonly cash: readonly CashBalance[];
  readonly quotes: readonly Quote[];
  /** Rates on or before `date` are used (carry-forward, § 0.3 and § 2.3). */
  readonly fxRates: FxRateTable;
  readonly date: IsoDate;
  /** Reporting currency of the portfolio total (default PLN). */
  readonly currency?: string | undefined;
}

export interface PositionValuation {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly quantity: Quantity;
  readonly cost: Money;
  readonly price: Price | null;
  readonly priceAsOf: string | null;
  /** Quote currency → account currency. */
  readonly fxRate: FxRate | null;
  /** q · price · rate in the account currency; null when the price or rate is missing. */
  readonly marketValue: Money | null;
  /** § 4.1: value − remaining cost, in the account currency. */
  readonly unrealizedPl: Money | null;
  /** Unrealized P/L / remaining cost (fraction, § 0.1). */
  readonly unrealizedRatio: number | null;
}

export interface AccountValuation {
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly positions: readonly PositionValuation[];
  /** Valued positions only. */
  readonly marketValue: Money;
  /** Cash in all currencies converted to the account currency. */
  readonly cash: Money;
  /** V_a(t) = positions + cash (§ 5), without gaps. */
  readonly total: Money;
  /** Account currency → reporting currency. */
  readonly fxRate: FxRate | null;
  readonly totalReporting: Money | null;
  readonly isComplete: boolean;
}

export type ValuationGap =
  | { readonly kind: "price"; readonly accountId: string; readonly instrumentId: string }
  | {
      readonly kind: "fx";
      readonly accountId: string;
      readonly base: string;
      readonly quote: string;
    };

export interface PortfolioValuation {
  readonly date: IsoDate;
  readonly currency: CurrencyCode;
  readonly accounts: readonly AccountValuation[];
  /** V(t) = Σ V_a(t)·rate; accounts without a rate are left out and reported in `gaps`. */
  readonly total: Money;
  readonly isComplete: boolean;
  /** Oldest price timestamp used (FR-01.15). */
  readonly asOf: string | null;
  /** Oldest FX table date used (`fx_as_of`, § 2.3). */
  readonly fxAsOf: IsoDate | null;
  readonly gaps: readonly ValuationGap[];
}

/** Portfolio valuation (obliczenia-finansowe.md § 5): unrounded sums, explicit gaps, as-of stamps. */
export function valuePortfolio(input: ValuationInput): PortfolioValuation {
  const date = isoDate(input.date);
  const reporting = currencyCode(input.currency ?? PLN);
  const quotes = new Map<string, Quote>();
  for (const quote of input.quotes) {
    if (quotes.has(quote.instrumentId)) {
      throw new CoreError("invalid_price", "Duplicate quote for an instrument", {
        instrumentId: quote.instrumentId,
      });
    }
    quotes.set(quote.instrumentId, quote);
  }
  const gaps: ValuationGap[] = [];
  let asOf: string | null = null;
  let fxAsOf: IsoDate | null = null;

  function rate(accountId: string, base: string, quote: string): FxRate | null {
    const found = input.fxRates.onOrBefore(base, quote, date);
    if (!found) {
      gaps.push({ kind: "fx", accountId, base, quote });
      return null;
    }
    if (base !== quote && (fxAsOf === null || found.date < fxAsOf)) fxAsOf = found.date;
    return found;
  }

  const accounts = input.accounts.map((account): AccountValuation => {
    const currency = currencyCode(account.currency);
    const positions = input.positions
      .filter((position) => position.accountId === account.id)
      .map((position): PositionValuation => {
        assertSameCurrency(currency, position.cost.currency);
        const quote = quotes.get(position.instrumentId);
        if (!quote)
          gaps.push({ kind: "price", accountId: account.id, instrumentId: position.instrumentId });
        const fx = quote ? rate(account.id, quote.price.currency, currency) : null;
        let marketValue: Money | null = null;
        if (quote && fx) {
          marketValue = money(position.quantity.times(quote.price.amount).times(fx.rate), currency);
          if (asOf === null || Date.parse(quote.asOf) < Date.parse(asOf)) asOf = quote.asOf;
        }
        const unrealizedPl = marketValue ? subtractMoney(marketValue, position.cost) : null;
        return Object.freeze({
          accountId: account.id,
          instrumentId: position.instrumentId,
          quantity: position.quantity,
          cost: position.cost,
          price: quote?.price ?? null,
          priceAsOf: quote?.asOf ?? null,
          fxRate: fx,
          marketValue,
          unrealizedPl,
          unrealizedRatio:
            unrealizedPl && !position.cost.amount.isZero()
              ? unrealizedPl.amount.div(position.cost.amount).toNumber()
              : null,
        });
      });

    let complete = positions.every((p) => p.marketValue !== null);
    let cash = new Decimal(0);
    const balances = input.cash.filter((c) => c.accountId === account.id);
    for (const { balance } of balances) {
      const fx = rate(account.id, balance.currency, currency);
      if (fx) cash = cash.plus(balance.amount.times(fx.rate));
      else complete = false;
    }
    const marketValue = positions.reduce(
      (sum, p) => (p.marketValue ? sum.plus(p.marketValue.amount) : sum),
      new Decimal(0),
    );
    const total = marketValue.plus(cash);
    const empty = positions.length === 0 && balances.length === 0;
    const fx = empty ? null : rate(account.id, currency, reporting);
    if (!empty && !fx) complete = false;
    return Object.freeze({
      accountId: account.id,
      currency,
      positions: Object.freeze(positions),
      marketValue: money(marketValue, currency),
      cash: money(cash, currency),
      total: money(total, currency),
      fxRate: fx,
      totalReporting: empty
        ? zeroMoney(reporting)
        : fx
          ? money(total.times(fx.rate), reporting)
          : null,
      isComplete: complete,
    });
  });

  const total = accounts.reduce(
    (sum, a) => (a.totalReporting ? sum.plus(a.totalReporting.amount) : sum),
    new Decimal(0),
  );
  return Object.freeze({
    date,
    currency: reporting,
    accounts: Object.freeze(accounts),
    total: money(total, reporting),
    isComplete: accounts.every((a) => a.isComplete),
    asOf,
    fxAsOf,
    gaps: Object.freeze(gaps),
  });
}

export interface DayChange {
  readonly change: Money;
  /** Change / V(D−1); null when V(D−1) ≤ 0. */
  readonly ratio: number | null;
}

/** Day result (§ 5.1): Δ = V(t) − V(close D−1) − F_day; percent relative to V(D−1). */
export function dayChange(input: {
  readonly valueNow: Money;
  readonly valuePrevClose: Money;
  readonly externalFlows: Money;
}): DayChange {
  const change = subtractMoney(
    subtractMoney(input.valueNow, input.valuePrevClose),
    input.externalFlows,
  );
  const previous = input.valuePrevClose.amount;
  return Object.freeze({
    change,
    ratio:
      previous.isPositive() && !previous.isZero() ? change.amount.div(previous).toNumber() : null,
  });
}

export interface ExternalFlow {
  readonly transactionId: string;
  readonly accountId: string;
  readonly date: IsoDate;
  /** Portfolio perspective (§ 0.4): inflow +, outflow −. */
  readonly amount: Money;
}

export interface ExternalFlowOptions {
  /** `portfolio`: deposits and withdrawals; `account`: also transfers between own accounts. */
  readonly level: "portfolio" | "account";
  /** Market value of a security transfer on its day; transfers without a value are skipped. */
  readonly securityTransferValue?: ((tx: Transaction) => Money | undefined) | undefined;
}

/** External flows F (§ 0.4, § 1) in processing order. */
export function externalFlows(
  transactions: readonly Transaction[],
  options: ExternalFlowOptions,
): ExternalFlow[] {
  const flows: ExternalFlow[] = [];
  for (const tx of sortTransactions(transactions)) {
    let amount: Money | undefined;
    if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") amount = tx.amount;
    else if (options.level === "account") {
      if (tx.type === "CASH_TRANSFER_IN" || tx.type === "CASH_TRANSFER_OUT") amount = tx.amount;
      if (tx.type === "SECURITY_TRANSFER_IN" || tx.type === "SECURITY_TRANSFER_OUT") {
        const value = options.securityTransferValue?.(tx);
        if (value)
          amount =
            tx.type === "SECURITY_TRANSFER_IN"
              ? value
              : money(value.amount.negated(), value.currency);
      }
    }
    if (amount) {
      flows.push(
        Object.freeze({
          transactionId: tx.id,
          accountId: tx.accountId,
          date: tx.tradeDate,
          amount,
        }),
      );
    }
  }
  return flows;
}
