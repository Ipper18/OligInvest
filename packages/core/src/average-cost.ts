import type { IsoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { LedgerInput } from "./ledger.js";
import { type Money, money, type Quantity } from "./money.js";
import { sortTransactions, type Transaction } from "./transactions.js";
import { validateInput } from "./validation.js";

export interface AveragePosition {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly quantity: Quantity;
  /** Null while the pool holds units without an acquisition cost (§ 3.5). */
  readonly cost: Money | null;
  readonly unitCost: Money | null;
}

export interface AverageSale {
  readonly transactionId: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly tradeDate: IsoDate;
  readonly quantity: Quantity;
  /** c̄ at the moment of the sale. */
  readonly unitCost: Money | null;
  readonly proceeds: Money;
  readonly cost: Money | null;
  readonly realizedPl: Money | null;
}

export interface AverageCostView {
  readonly positions: readonly AveragePosition[];
  readonly sales: readonly AverageSale[];
}

interface Pool {
  accountId: string;
  instrumentId: string;
  currency: string;
  quantity: Decimal;
  cost: Decimal;
  known: boolean;
}

/**
 * Weighted average cost as an informational economic view (§ 3.3): c̄ is recomputed after every
 * purchase; a sale takes q·c̄ and leaves c̄ of the remaining units unchanged. FIFO stays the
 * default and the only basis of the tax view (art. 24 ust. 10 PIT).
 */
export function buildAverageCostView(input: LedgerInput): AverageCostView {
  validateInput(input.accounts, input.transactions);
  const pools = new Map<string, Pool>();
  const moved = new Map<
    string,
    { quantity: Decimal; cost: Decimal; known: boolean; currency: string; instrumentId: string }
  >();
  const sales: AverageSale[] = [];
  const outIds = new Set<string>();
  const outLinkedTo = new Set<string>();
  for (const tx of input.transactions) {
    if (tx.type !== "SECURITY_TRANSFER_OUT") continue;
    outIds.add(tx.id);
    if (tx.relatedTransactionId !== undefined) outLinkedTo.add(tx.relatedTransactionId);
  }

  const pool = (accountId: string, instrumentId: string, currency: string): Pool => {
    const key = `${accountId}\u0000${instrumentId}`;
    let found = pools.get(key);
    if (!found) {
      found = {
        accountId,
        instrumentId,
        currency,
        quantity: new Decimal(0),
        cost: new Decimal(0),
        known: true,
      };
      pools.set(key, found);
    }
    return found;
  };

  const take = (p: Pool, units: Decimal, tx: Transaction): Decimal => {
    if (units.greaterThan(p.quantity)) {
      throw new CoreError("short_position", "Sale or transfer exceeds the quantity held", {
        transactionId: tx.id,
        available: p.quantity.toFixed(),
        requested: units.toFixed(),
      });
    }
    const cost = units.equals(p.quantity) ? p.cost : p.cost.times(units).div(p.quantity);
    p.quantity = p.quantity.minus(units);
    p.cost = p.cost.minus(cost);
    if (p.quantity.isZero()) p.known = true;
    return cost;
  };

  const currencyOf = (accountId: string) =>
    (input.accounts.find((a) => a.id === accountId) as { currency: string }).currency;

  for (const tx of sortTransactions(input.transactions)) {
    switch (tx.type) {
      case "BUY": {
        const p = pool(tx.accountId, tx.instrumentId, currencyOf(tx.accountId));
        p.quantity = p.quantity.plus(tx.quantity);
        p.cost = p.cost.plus(tx.amount.amount.negated());
        break;
      }
      case "SELL": {
        const p = pool(tx.accountId, tx.instrumentId, currencyOf(tx.accountId));
        const known = p.known;
        const unitCost = p.quantity.isZero() ? new Decimal(0) : p.cost.div(p.quantity);
        const cost = take(p, tx.quantity, tx);
        sales.push(
          Object.freeze({
            transactionId: tx.id,
            accountId: tx.accountId,
            instrumentId: tx.instrumentId,
            tradeDate: tx.tradeDate,
            quantity: tx.quantity,
            unitCost: known ? money(unitCost, p.currency) : null,
            proceeds: tx.amount,
            cost: known ? money(cost, p.currency) : null,
            realizedPl: known ? money(tx.amount.amount.minus(cost), p.currency) : null,
          }),
        );
        break;
      }
      case "SPLIT": {
        const p = pool(tx.accountId, tx.instrumentId, currencyOf(tx.accountId));
        const kept = p.quantity
          .times(tx.ratioTo)
          .div(tx.ratioFrom)
          .toDecimalPlaces(0, Decimal.ROUND_DOWN);
        const fraction = p.quantity.minus(kept.times(tx.ratioFrom).div(tx.ratioTo));
        if (tx.cashInLieu && fraction.isPositive() && !fraction.isZero()) {
          const known = p.known;
          const unitCost = p.cost.div(p.quantity);
          const cost = take(p, fraction, tx);
          sales.push(
            Object.freeze({
              transactionId: tx.id,
              accountId: tx.accountId,
              instrumentId: tx.instrumentId,
              tradeDate: tx.tradeDate,
              quantity: fraction as Quantity,
              unitCost: known ? money(unitCost, p.currency) : null,
              proceeds: tx.cashInLieu,
              cost: known ? money(cost, p.currency) : null,
              realizedPl: known ? money(tx.cashInLieu.amount.minus(cost), p.currency) : null,
            }),
          );
        }
        p.quantity = p.quantity.times(tx.ratioTo).div(tx.ratioFrom);
        break;
      }
      case "SECURITY_TRANSFER_OUT": {
        const p = pool(tx.accountId, tx.instrumentId, currencyOf(tx.accountId));
        const known = p.known;
        const record = {
          quantity: tx.quantity,
          known,
          cost: take(p, tx.quantity, tx),
          currency: p.currency,
          instrumentId: tx.instrumentId,
        };
        moved.set(tx.id, record);
        if (tx.relatedTransactionId !== undefined)
          moved.set(`in:${tx.relatedTransactionId}`, record);
        break;
      }
      case "SECURITY_TRANSFER_IN": {
        const record =
          (tx.relatedTransactionId === undefined
            ? undefined
            : moved.get(tx.relatedTransactionId)) ?? moved.get(`in:${tx.id}`);
        const pendingOut =
          (tx.relatedTransactionId !== undefined && outIds.has(tx.relatedTransactionId)) ||
          outLinkedTo.has(tx.id);
        if (
          (record &&
            (record.instrumentId !== tx.instrumentId || !record.quantity.equals(tx.quantity))) ||
          (!record && pendingOut)
        ) {
          throw new CoreError(
            "unmatched_security_transfer",
            "SECURITY_TRANSFER_IN must follow a matching SECURITY_TRANSFER_OUT (same instrument and quantity)",
            { transactionId: tx.id },
          );
        }
        const p = pool(tx.accountId, tx.instrumentId, currencyOf(tx.accountId));
        p.quantity = p.quantity.plus(tx.quantity);
        if (record) {
          // Between currencies: the NBP rate of the transfer day (§ 3.5), else an unknown cost.
          const rate =
            record.currency === p.currency
              ? undefined
              : input.taxRates?.onOrBefore(record.currency, p.currency, tx.tradeDate);
          const converted = record.currency === p.currency || rate !== undefined;
          p.cost = p.cost.plus(
            rate ? record.cost.times(rate.rate) : converted ? record.cost : new Decimal(0),
          );
          p.known = p.known && record.known && converted;
        } else if (tx.acquisitionCost !== undefined) {
          p.cost = p.cost.plus(tx.acquisitionCost.amount);
        } else {
          p.known = false;
        }
        break;
      }
      default:
        break;
    }
  }

  const order = new Map(input.accounts.map((a, i) => [a.id, i]));
  const positions = [...pools.values()]
    .filter((p) => !p.quantity.isZero())
    .sort(
      (a, b) =>
        (order.get(a.accountId) as number) - (order.get(b.accountId) as number) ||
        (a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0),
    )
    .map((p) =>
      Object.freeze({
        accountId: p.accountId,
        instrumentId: p.instrumentId,
        quantity: p.quantity as Quantity,
        cost: p.known ? money(p.cost, p.currency) : null,
        unitCost: p.known ? money(p.cost.div(p.quantity), p.currency) : null,
      }),
    );
  return Object.freeze({ positions: Object.freeze(positions), sales: Object.freeze(sales) });
}
