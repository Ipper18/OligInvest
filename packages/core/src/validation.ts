import { currencyCode } from "./currency.js";
import { CoreError } from "./errors.js";
import type { Money } from "./money.js";
import {
  ACCOUNT_TYPES,
  type Account,
  type Transaction,
  validateTransaction,
} from "./transactions.js";

/**
 * `TAX`/`FEE` linked by `relatedTransactionId` to a BUY, SELL or DIVIDEND of the same account
 * (formaty-importu.md § 2.2: FTT, SEC fee, withholding tax on a separate row). Their signed cash
 * amounts belong to the target: purchase cost, sale proceeds, withholding tax (OBL § 4.4).
 */
export function linkedCharges(transactions: readonly Transaction[]): Map<string, Money[]> {
  const byId = new Map(transactions.map((tx) => [tx.id, tx]));
  const linked = new Map<string, Money[]>();
  for (const tx of transactions) {
    if ((tx.type !== "TAX" && tx.type !== "FEE") || tx.relatedTransactionId === undefined) continue;
    const target = byId.get(tx.relatedTransactionId);
    if (!target || !["BUY", "SELL", "DIVIDEND"].includes(target.type)) continue;
    const expected =
      target.type === "DIVIDEND"
        ? target.gross.currency
        : (target as { amount: Money }).amount.currency;
    if (target.accountId !== tx.accountId || tx.amount.currency !== expected) {
      throw new CoreError(
        "invalid_transaction",
        "Linked charge must match its operation's account and currency",
        {
          transactionId: tx.id,
          field: "relatedTransactionId",
        },
      );
    }
    linked.set(target.id, [...(linked.get(target.id) ?? []), tx.amount]);
  }
  return linked;
}

/** Shared input checks of the ledger views (internal, not part of the public API). */
export function validateInput(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Map<string, Account> {
  const byId = new Map<string, Account>();
  for (const account of accounts) {
    if (
      typeof account?.id !== "string" ||
      byId.has(account.id) ||
      !(ACCOUNT_TYPES as readonly string[]).includes(account.accountType)
    ) {
      throw new CoreError("invalid_account", "Invalid or duplicate account", {
        accountId: typeof account?.id === "string" ? account.id : null,
      });
    }
    currencyCode(account.currency);
    byId.set(account.id, account);
  }
  const seen = new Set<string>();
  for (const tx of transactions) {
    const account = byId.get(tx.accountId);
    if (!account) {
      throw new CoreError("invalid_account", "Transaction refers to an unknown account", {
        transactionId: tx.id,
        accountId: tx.accountId,
      });
    }
    validateTransaction(tx, account);
    if (seen.has(tx.id)) {
      throw new CoreError("invalid_transaction", "Duplicate transaction id", {
        transactionId: tx.id,
      });
    }
    seen.add(tx.id);
  }
  return byId;
}
