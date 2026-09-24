import { currencyCode } from "./currency.js";
import { CoreError } from "./errors.js";
import {
  ACCOUNT_TYPES,
  type Account,
  type Transaction,
  validateTransaction,
} from "./transactions.js";

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
