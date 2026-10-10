import {
  type Account,
  addMoney,
  convertMoney,
  currencyCode,
  fxConversionCost,
  fxRate,
  grossValue,
  isoDate,
  midFxRate,
  moneyFromJson,
  moneyToJson,
  negateMoney,
  price,
  quantity,
  roundMoney,
  subtractMoney,
  type Transaction,
  validateTransaction,
  zeroMoney,
} from "@oliginvest/core";
import { type TransactionInput, transactionInput } from "../contracts.js";
export function toCoreTransaction(
  input: TransactionInput,
  id: string,
  broker = "other",
): Transaction {
  const base = {
    id,
    accountId: input.accountId,
    tradeDate: isoDate(input.tradeDate),
    ...(input.settleDate ? { settleDate: isoDate(input.settleDate) } : {}),
    executedAt: input.executedAt,
    sequence: input.sequence,
    relatedTransactionId: input.relatedTransactionId,
  };
  const instrumentId = input.instrumentId!;
  if (input.type === "SPLIT")
    return {
      ...base,
      type: "SPLIT",
      instrumentId,
      ratioFrom: input.ratioFrom!,
      ratioTo: input.ratioTo!,
      ...(input.cashInLieu ? { cashInLieu: moneyFromJson(input.cashInLieu) } : {}),
    };
  if (input.type === "SECURITY_TRANSFER_IN" || input.type === "SECURITY_TRANSFER_OUT")
    return {
      ...base,
      type: input.type,
      instrumentId,
      quantity: quantity(input.quantity!),
      ...(input.acquisitionCost
        ? {
            acquisitionCost: moneyFromJson(input.acquisitionCost),
            acquiredOn: isoDate(input.acquiredOn!),
          }
        : {}),
    };
  const amount = moneyFromJson(input.amount!);
  if (input.type === "FX_CONVERSION")
    return {
      ...base,
      type: "FX_CONVERSION",
      amount,
      counterAmount: moneyFromJson(input.counterAmount!),
    };
  if (input.type === "DIVIDEND")
    return {
      ...base,
      type: "DIVIDEND",
      instrumentId,
      amount,
      gross: grossValue(price(input.price!, input.priceCurrency!), quantity(input.quantity!)),
      ...(input.tax ? { withholdingTax: moneyFromJson(input.tax) } : {}),
    };
  if (input.type === "BUY" || input.type === "SELL") {
    const unitPrice = price(input.price!, input.priceCurrency!);
    const units = quantity(input.quantity!);
    let fxFee = zeroMoney(amount.currency);
    if (input.fxRate && unitPrice.currency !== amount.currency && broker === "xtb") {
      const brokerRate = fxRate({
        base: unitPrice.currency,
        quote: amount.currency,
        rate: input.fxRate,
        date: input.tradeDate,
        source: input.fxSource ?? "manual",
      });
      fxFee = fxConversionCost(
        grossValue(unitPrice, units),
        midFxRate(brokerRate, "0.005", input.type === "BUY" ? "buy" : "sell"),
        "0.005",
      );
    }
    return {
      ...base,
      type: input.type,
      instrumentId,
      amount,
      quantity: units,
      price: unitPrice,
      fxFee,
      ...(input.fee ? { fee: moneyFromJson(input.fee) } : {}),
      ...(input.tax ? { tax: moneyFromJson(input.tax) } : {}),
    };
  }
  return { ...base, type: input.type, amount, category: input.category };
}
export function normalizeTransaction(
  raw: unknown,
  account: Account & { broker?: string },
): TransactionInput & { amount: { amount: string; currency: string } } {
  const input = transactionInput.parse(raw);
  if (input.accountId !== account.id) throw Error("ACCOUNT_MISMATCH");
  let amount = input.amount;
  if ((input.type === "BUY" || input.type === "SELL") && !amount) {
    let gross = grossValue(price(input.price!, input.priceCurrency!), quantity(input.quantity!));
    if (gross.currency !== account.currency) {
      if (!input.fxRate) throw Error("MISSING_FX_RATE");
      gross = convertMoney(
        gross,
        fxRate({
          base: gross.currency,
          quote: account.currency,
          rate: input.fxRate,
          date: input.tradeDate,
          source: input.fxSource ?? "manual",
        }),
      );
    }
    const charges = addMoney(
      input.fee ? moneyFromJson(input.fee) : zeroMoney(account.currency),
      input.tax ? moneyFromJson(input.tax) : zeroMoney(account.currency),
    );
    amount = moneyToJson(
      roundMoney(subtractMoney(input.type === "BUY" ? negateMoney(gross) : gross, charges)),
    );
  }
  amount ??= moneyToJson(zeroMoney(account.currency));
  const result = { ...input, amount };
  validateTransaction(toCoreTransaction(result, "validation", account.broker), {
    ...account,
    currency: currencyCode(account.currency),
  });
  if (input.type === "SPLIT" && input.amount && input.amount.amount !== "0")
    throw Error("SPLIT_CASH_USES_CASH_IN_LIEU");
  return result;
}
