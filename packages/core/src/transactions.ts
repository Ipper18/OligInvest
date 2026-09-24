import { type CurrencyCode, currencyCode } from "./currency.js";
import { type IsoDate, isoDate } from "./dates.js";
import { Decimal } from "./decimal.js";
import { CoreError } from "./errors.js";
import type { Money, Price, Quantity } from "./money.js";

/** Operation types of `portfolio.transactions` (obliczenia-finansowe.md § 1). */
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "TAX",
  "DEPOSIT",
  "WITHDRAWAL",
  "CASH_TRANSFER_IN",
  "CASH_TRANSFER_OUT",
  "FX_CONVERSION",
  "SPLIT",
  "SECURITY_TRANSFER_IN",
  "SECURITY_TRANSFER_OUT",
  "ADJUSTMENT",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_TYPES = ["regular", "ike", "ikze", "demo"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  readonly id: string;
  readonly currency: CurrencyCode;
  readonly accountType: AccountType;
}

interface TransactionBase {
  readonly id: string;
  readonly accountId: string;
  readonly tradeDate: IsoDate;
  /** Settlement date = tax day (§ 2.2); fill with `settlementDate` when the source lacks it. */
  readonly settleDate?: IsoDate | undefined;
  /** ISO 8601 instant; orders operations within a day (§ 1). */
  readonly executedAt?: string | undefined;
  /** Order within a day for operations without `executedAt` (default 0). */
  readonly sequence?: number | undefined;
  readonly relatedTransactionId?: string | undefined;
}

/**
 * BUY/SELL. `amount` is the signed cash impact in the account currency exactly as settled by the
 * broker (BUY < 0, SELL ≥ 0) and already includes `fee`, `tax` (e.g. FTT) and `fxFee`.
 */
export interface TradeTransaction extends TransactionBase {
  readonly type: "BUY" | "SELL";
  readonly instrumentId: string;
  readonly quantity: Quantity;
  readonly price: Price;
  readonly amount: Money;
  readonly fee?: Money | undefined;
  readonly tax?: Money | undefined;
  /** Broker FX margin cost (§ 2.1) in the `amount` currency; tax view shows it as `fxCosts`. */
  readonly fxFee?: Money | undefined;
}

/** Dividend: `amount` = net credited to the account; `gross` and `withholdingTax` in payout currency. */
export interface DividendTransaction extends TransactionBase {
  readonly type: "DIVIDEND";
  readonly instrumentId: string;
  readonly amount: Money;
  readonly gross: Money;
  readonly withholdingTax?: Money | undefined;
}

export interface CashTransaction extends TransactionBase {
  readonly type:
    | "INTEREST"
    | "FEE"
    | "TAX"
    | "DEPOSIT"
    | "WITHDRAWAL"
    | "CASH_TRANSFER_IN"
    | "CASH_TRANSFER_OUT"
    | "ADJUSTMENT";
  readonly amount: Money;
  readonly category?: string | undefined;
}

/** Currency exchange within the account: `amount` < 0 (sold), `counterAmount` > 0 (bought). */
export interface FxConversionTransaction extends TransactionBase {
  readonly type: "FX_CONVERSION";
  readonly amount: Money;
  readonly counterAmount: Money;
}

/**
 * Split as a pair of integers (§ 3.4, owner decision 2026-09-24): `ratioFrom` old units become
 * `ratioTo` new units — split 4:1 → 1 → 4, reverse split 1:3 → 3 → 1; quantity q·to/from.
 */
export interface SplitTransaction extends TransactionBase {
  readonly type: "SPLIT";
  readonly instrumentId: string;
  readonly ratioFrom: number;
  readonly ratioTo: number;
  /** Cash paid for the fraction left after a reverse split (`cash_in_lieu`), account currency. */
  readonly cashInLieu?: Money | undefined;
}

/**
 * Moves lots with their original date and cost; IN links to its OUT via `relatedTransactionId`.
 * An IN without an OUT (transfer from outside the tracked accounts) takes the cost and acquisition
 * date declared by the user; without them the lot has an unknown cost (§ 3.5).
 */
export interface SecurityTransferTransaction extends TransactionBase {
  readonly type: "SECURITY_TRANSFER_IN" | "SECURITY_TRANSFER_OUT";
  readonly instrumentId: string;
  readonly quantity: Quantity;
  /** IN only: declared economic cost of the units, in the account currency. */
  readonly acquisitionCost?: Money | undefined;
  /** IN only: declared acquisition date (FIFO order and tax day of the cost). */
  readonly acquiredOn?: IsoDate | undefined;
}

export type Transaction =
  | TradeTransaction
  | DividendTransaction
  | CashTransaction
  | FxConversionTransaction
  | SplitTransaction
  | SecurityTransferTransaction;

function executedAtMs(tx: Transaction): number {
  return tx.executedAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(tx.executedAt);
}

/**
 * Total processing order (§ 1): trade date; SPLIT before other operations of the day; `executedAt`
 * (operations without it after timed ones); `sequence`; `id` (UUIDv7 ascending).
 */
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  const split = (a.type === "SPLIT" ? 0 : 1) - (b.type === "SPLIT" ? 0 : 1);
  if (split !== 0) return split;
  const executed = executedAtMs(a) - executedAtMs(b);
  if (executed !== 0 && !Number.isNaN(executed)) return Math.sign(executed);
  const sequence = (a.sequence ?? 0) - (b.sequence ?? 0);
  if (sequence !== 0) return Math.sign(sequence);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTransactions<T extends Transaction>(transactions: readonly T[]): T[] {
  return [...transactions].sort(compareTransactions);
}

function fail(tx: { readonly id?: unknown }, field: string, message: string): never {
  throw new CoreError("invalid_transaction", message, {
    transactionId: typeof tx.id === "string" ? tx.id : null,
    field,
  });
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    Decimal.isDecimal((value as Money).amount) &&
    (value as Money).amount.isFinite() &&
    typeof (value as Money).currency === "string"
  );
}

function checkMoney(
  tx: Transaction,
  field: string,
  value: unknown,
  sign?: "neg" | "pos" | "nonneg",
) {
  if (!isMoney(value)) fail(tx, field, "Expected Money");
  currencyCode(value.currency);
  const amount = value.amount;
  const negative = amount.isNegative() && !amount.isZero();
  if (
    (sign === "neg" && !negative && !amount.isZero()) ||
    (sign === "pos" && (negative || amount.isZero())) ||
    (sign === "nonneg" && negative)
  ) {
    fail(tx, field, `Invalid sign of ${field} for ${tx.type}`);
  }
  return value;
}

function checkPositiveDecimal(tx: Transaction, field: string, value: unknown) {
  if (!Decimal.isDecimal(value) || !value.isFinite() || !value.isPositive() || value.isZero()) {
    fail(tx, field, `${field} must be a positive Decimal`);
  }
}

function checkInstrument(tx: Transaction, value: unknown) {
  if (typeof value !== "string" || value === "") fail(tx, "instrumentId", "Missing instrument");
}

/** Per-type checks mirroring `schema.sql` constraints and the sign conventions of § 1. */
export function validateTransaction(tx: Transaction, account: Account): void {
  if (typeof tx.id !== "string" || tx.id === "") fail(tx, "id", "Missing id");
  isoDate(tx.tradeDate);
  if (tx.settleDate !== undefined) isoDate(tx.settleDate);
  if (tx.executedAt !== undefined && Number.isNaN(Date.parse(tx.executedAt))) {
    fail(tx, "executedAt", "executedAt must be an ISO 8601 instant");
  }
  if (tx.sequence !== undefined && !Number.isInteger(tx.sequence)) {
    fail(tx, "sequence", "sequence must be an integer");
  }
  switch (tx.type) {
    case "BUY":
    case "SELL": {
      checkInstrument(tx, tx.instrumentId);
      checkPositiveDecimal(tx, "quantity", tx.quantity);
      if (!isMoney(tx.price) || tx.price.amount.isNegative()) fail(tx, "price", "Invalid price");
      const amount = checkMoney(tx, "amount", tx.amount, tx.type === "BUY" ? "neg" : "nonneg");
      if (amount.currency !== account.currency) {
        fail(tx, "amount", "Trade amount must be in the account currency");
      }
      if (tx.fee !== undefined) checkMoney(tx, "fee", tx.fee, "nonneg");
      if (tx.tax !== undefined) checkMoney(tx, "tax", tx.tax, "nonneg");
      if (tx.fxFee !== undefined) {
        const fxFee = checkMoney(tx, "fxFee", tx.fxFee, "nonneg");
        if (fxFee.currency !== amount.currency) {
          fail(tx, "fxFee", "fxFee must be in the amount currency");
        }
      }
      return;
    }
    case "DIVIDEND": {
      checkInstrument(tx, tx.instrumentId);
      checkMoney(tx, "amount", tx.amount, "nonneg");
      const gross = checkMoney(tx, "gross", tx.gross, "nonneg");
      if (tx.withholdingTax !== undefined) {
        const wht = checkMoney(tx, "withholdingTax", tx.withholdingTax, "nonneg");
        if (wht.currency !== gross.currency || wht.amount.greaterThan(gross.amount)) {
          fail(tx, "withholdingTax", "Withholding tax must be ≤ gross, in the gross currency");
        }
      }
      return;
    }
    case "DEPOSIT":
    case "CASH_TRANSFER_IN":
      checkMoney(tx, "amount", tx.amount, "pos");
      return;
    case "WITHDRAWAL":
    case "CASH_TRANSFER_OUT":
      checkMoney(tx, "amount", tx.amount, "neg");
      if (tx.amount.amount.isZero()) fail(tx, "amount", "Amount cannot be zero");
      return;
    case "INTEREST":
    case "FEE":
    case "TAX":
    case "ADJUSTMENT":
      checkMoney(tx, "amount", tx.amount);
      return;
    case "FX_CONVERSION": {
      const sold = checkMoney(tx, "amount", tx.amount, "neg");
      const bought = checkMoney(tx, "counterAmount", tx.counterAmount, "pos");
      if (sold.amount.isZero() || sold.currency === bought.currency) {
        fail(tx, "counterAmount", "FX conversion needs two different currencies");
      }
      return;
    }
    case "SPLIT":
      checkInstrument(tx, tx.instrumentId);
      for (const [field, value] of [
        ["ratioFrom", tx.ratioFrom],
        ["ratioTo", tx.ratioTo],
      ] as const) {
        if (!Number.isSafeInteger(value) || value < 1) {
          fail(tx, field, "Split ratio must be a pair of positive integers");
        }
      }
      if (tx.cashInLieu !== undefined) {
        const lieu = checkMoney(tx, "cashInLieu", tx.cashInLieu, "nonneg");
        if (lieu.currency !== account.currency) {
          fail(tx, "cashInLieu", "Cash in lieu must be in the account currency");
        }
      }
      return;
    case "SECURITY_TRANSFER_IN":
    case "SECURITY_TRANSFER_OUT": {
      checkInstrument(tx, tx.instrumentId);
      checkPositiveDecimal(tx, "quantity", tx.quantity);
      const declared = [tx.acquisitionCost, tx.acquiredOn].filter((v) => v !== undefined).length;
      if (declared > 0 && (declared < 2 || tx.type === "SECURITY_TRANSFER_OUT")) {
        fail(tx, "acquisitionCost", "An inbound transfer declares both cost and acquisition date");
      }
      if (tx.acquisitionCost !== undefined) {
        const cost = checkMoney(tx, "acquisitionCost", tx.acquisitionCost, "nonneg");
        if (cost.currency !== account.currency) {
          fail(tx, "acquisitionCost", "Declared cost must be in the account currency");
        }
        isoDate(tx.acquiredOn as string);
      }
      return;
    }
    default:
      fail(tx, "type", "Unknown transaction type");
  }
}
