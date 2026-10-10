import { buildLedger, moneyToJson } from "@oliginvest/core";
import { describe, expect, test } from "vitest";
import { accountInput, transactionInput } from "../src/contracts.js";
import { normalizeTransaction, toCoreTransaction } from "../src/domain/transactions.js";

const account = {
  id: "0198a000-0000-7000-8000-000000000001",
  currency: "PLN",
  accountType: "regular",
  broker: "xtb",
};
const instrumentId = "0198a000-0000-7000-8000-000000000002";
const tx = (type, fields = {}) => ({
  accountId: account.id,
  type,
  tradeDate: "2025-03-03",
  ...fields,
});
const cash = (amount) => ({ amount, currency: "PLN" });
describe("operation boundary and core integration", () => {
  test("rejects unknown keys, numeric money, ambiguous instants and incomplete dividends", () => {
    expect(
      accountInput.safeParse({
        name: "A",
        broker: "xtb",
        accountType: "regular",
        currency: "PLN",
        userId: account.id,
      }).success,
    ).toBe(false);
    for (const value of [
      tx("DEPOSIT", { amount: { amount: 10, currency: "PLN" } }),
      tx("DIVIDEND", { instrumentId, amount: cash("10") }),
      tx("DEPOSIT", { amount: cash("10"), executedAt: "2025-03-03T12:00:00" }),
    ])
      expect(transactionInput.safeParse(value).success).toBe(false);
  });
  test("computes manual BUY cash in core and validates every currency", () => {
    const value = normalizeTransaction(
      tx("BUY", { instrumentId, quantity: "2", price: "30", priceCurrency: "PLN", fee: cash("1") }),
      account,
    );
    expect(value.amount).toEqual(cash("-61"));
    expect(() =>
      normalizeTransaction(
        tx("BUY", { instrumentId, quantity: "2", price: "30", priceCurrency: "USD" }),
        account,
      ),
    ).toThrow();
    expect(() =>
      normalizeTransaction(
        tx("BUY", {
          instrumentId,
          quantity: "2",
          price: "30",
          priceCurrency: "PLN",
          amount: { amount: "-60", currency: "USD" },
        }),
        account,
      ),
    ).toThrow();
  });
  test("cash types and currency conversion preserve signed balances", () => {
    const types = [
      ["DEPOSIT", "100"],
      ["WITHDRAWAL", "-10"],
      ["INTEREST", "2"],
      ["FEE", "-1"],
      ["TAX", "-1"],
      ["CASH_TRANSFER_IN", "5"],
      ["CASH_TRANSFER_OUT", "-5"],
      ["ADJUSTMENT", "3"],
    ];
    const inputs = types.map(([type, amount]) => tx(type, { amount: cash(amount) }));
    inputs.push(
      tx("FX_CONVERSION", {
        amount: cash("-40"),
        counterAmount: { amount: "10", currency: "USD" },
      }),
    );
    const ledger = buildLedger({
      accounts: [account],
      transactions: inputs.map((input, i) =>
        toCoreTransaction(normalizeTransaction(input, account), String(i)),
      ),
    });
    expect(ledger.cash.map((c) => [c.balance.currency, c.balance.amount.toFixed()])).toEqual(
      expect.arrayContaining([
        ["PLN", "53"],
        ["USD", "10"],
      ]),
    );
  });
  test("reverse split and unknown acquisition cost preserve core semantics", () => {
    const inputs = [
      tx("SECURITY_TRANSFER_IN", { instrumentId, quantity: "31" }),
      tx("SPLIT", {
        instrumentId,
        tradeDate: "2025-03-04",
        ratioFrom: 3,
        ratioTo: 1,
        cashInLieu: cash("5"),
      }),
    ];
    const ledger = buildLedger({
      accounts: [account],
      transactions: inputs.map((input, i) =>
        toCoreTransaction(normalizeTransaction(input, account), String(i)),
      ),
    });
    expect(ledger.positions[0].quantity.toFixed()).toBe("10");
    expect(ledger.positions[0].cost).toBeNull();
    expect(ledger.issues.some((i) => i.code === "missing_acquisition_cost")).toBe(true);
  });
  test("dividend gross uses share count and gross unit price, separate from net cash", () => {
    const value = toCoreTransaction(
      normalizeTransaction(
        tx("DIVIDEND", {
          instrumentId,
          quantity: "100",
          price: "0.25",
          priceCurrency: "USD",
          amount: cash("77.81"),
          tax: { amount: "3.75", currency: "USD" },
        }),
        account,
      ),
      "div",
    );
    expect(moneyToJson(value.gross)).toEqual({ amount: "25", currency: "USD" });
  });
});
