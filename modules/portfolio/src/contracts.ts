import { z } from "@hono/zod-openapi";
import { TRANSACTION_TYPES } from "@oliginvest/core";
import { summarySchema } from "@oliginvest/mod-market/contracts";
export const object = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().openapi({ additionalProperties: true });
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,10})?$/);
export const moneySchema = object({
  amount: z.string().regex(/^-?\d{1,14}(\.\d{1,8})?$/),
  currency,
}).openapi("Money");
const date = z.string().date();
export const accountInput = object({
  name: z.string().min(1).max(60),
  broker: z.enum(["xtb", "mbank", "other", "demo"]),
  accountType: z.enum(["regular", "ike", "ikze", "demo"]),
  currency,
  externalRef: z.string().max(40).optional(),
  openedOn: date.optional(),
}).openapi("AccountInput");
export const accountPatch = object({
  name: z.string().min(1).max(60).optional(),
  accountType: accountInput.shape.accountType.optional(),
  externalRef: z.string().max(40).nullable().optional(),
  closedOn: z.union([date, z.null()]).openapi({}, { unionPreferredType: "oneOf" }).optional(),
})
  .refine((v) => Object.keys(v).length > 0)
  .openapi("AccountPatch", { minProperties: 1 });
export const accountSchema = object({
  ...accountInput.shape,
  id: z.uuid(),
  closedOn: date.optional(),
  lastImportAt: z.string().datetime().optional(),
  reconciliationStatus: z.enum(["ok", "differences", "never_imported"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi("Account");
export const transactionFields = object({
  executedAt: z.iso.datetime({ offset: true }).optional(),
  settleDate: date.optional(),
  sequence: z.number().int().min(0).optional(),
  instrumentId: z.uuid().optional(),
  quantity: decimal.optional(),
  price: decimal.optional(),
  priceCurrency: currency.optional(),
  amount: moneySchema.optional(),
  fee: moneySchema.optional(),
  tax: moneySchema.optional(),
  fxRate: decimal.optional(),
  fxSource: z.enum(["broker", "implied", "nbp_fallback", "manual"]).optional(),
  ratioFrom: z.number().int().min(1).max(2147483647).optional(),
  ratioTo: z.number().int().min(1).max(2147483647).optional(),
  cashInLieu: moneySchema.optional(),
  acquisitionCost: moneySchema.optional(),
  acquiredOn: date.optional(),
  counterAmount: moneySchema.optional(),
  category: z.string().max(40).optional(),
  relatedTransactionId: z.uuid().optional(),
  note: z.string().max(500).optional(),
}).openapi("TransactionFields");
const inputObject = object({
  ...transactionFields.shape,
  accountId: z.uuid(),
  type: z.enum(TRANSACTION_TYPES),
  tradeDate: date,
});
export const transactionInput = inputObject
  .superRefine((v, ctx) => {
    const required: string[] = [];
    if (
      [
        "BUY",
        "SELL",
        "DIVIDEND",
        "SPLIT",
        "SECURITY_TRANSFER_IN",
        "SECURITY_TRANSFER_OUT",
      ].includes(v.type)
    )
      required.push("instrumentId");
    if (
      ["BUY", "SELL", "DIVIDEND", "SECURITY_TRANSFER_IN", "SECURITY_TRANSFER_OUT"].includes(v.type)
    )
      required.push("quantity");
    if (["BUY", "SELL", "DIVIDEND"].includes(v.type)) required.push("price", "priceCurrency");
    if (v.type === "SPLIT") required.push("ratioFrom", "ratioTo");
    if (v.type === "FX_CONVERSION") required.push("amount", "counterAmount");
    if (!["BUY", "SELL", "SPLIT", "SECURITY_TRANSFER_IN", "SECURITY_TRANSFER_OUT"].includes(v.type))
      required.push("amount");
    for (const field of required)
      if (v[field as keyof typeof v] === undefined)
        ctx.addIssue({ code: "custom", path: [field], message: "Wymagane pole operacji." });
    if ((v.acquisitionCost === undefined) !== (v.acquiredOn === undefined))
      ctx.addIssue({
        code: "custom",
        path: ["acquisitionCost"],
        message: "Koszt i data nabycia wymagane razem.",
      });
  })
  .openapi("TransactionInput", {
    allOf: [
      {
        if: {
          properties: {
            type: { enum: ["BUY", "SELL", "SECURITY_TRANSFER_IN", "SECURITY_TRANSFER_OUT"] },
          },
        },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["instrumentId", "quantity"] },
      },
      {
        if: { properties: { type: { enum: ["BUY", "SELL"] } } },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["price", "priceCurrency"] },
      },
      {
        if: { properties: { type: { enum: ["DIVIDEND", "SPLIT"] } } },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["instrumentId"] },
      },
      {
        if: { properties: { type: { const: "SPLIT" } } },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["ratioFrom", "ratioTo"] },
      },
      {
        if: { properties: { type: { const: "DIVIDEND" } } },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["quantity", "price", "priceCurrency"] },
      },
      {
        if: { properties: { type: { const: "FX_CONVERSION" } } },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["amount", "counterAmount"] },
      },
      {
        if: {
          properties: {
            type: {
              enum: [
                "DIVIDEND",
                "INTEREST",
                "FEE",
                "TAX",
                "DEPOSIT",
                "WITHDRAWAL",
                "CASH_TRANSFER_IN",
                "CASH_TRANSFER_OUT",
                "ADJUSTMENT",
              ],
            },
          },
        },
        // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
        then: { required: ["amount"] },
      },
    ],
  } as unknown as NonNullable<Parameters<typeof transactionFields.openapi>[1]>);
export const transactionPatch = object({ ...transactionFields.shape, tradeDate: date.optional() })
  .refine((v) => Object.keys(v).length > 0)
  .openapi("TransactionPatch", { minProperties: 1 });
export const transactionSchema = object({
  ...inputObject.shape,
  id: z.uuid(),
  amount: moneySchema,
  instrument: summarySchema.optional(),
  source: z.enum(["manual", "import", "quick", "demo"]),
  importBatchId: z.uuid().optional(),
  externalId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi("Transaction");
export type TransactionInput = z.infer<typeof transactionInput>;
export type AccountInput = z.infer<typeof accountInput>;
export type TransactionRecord = z.infer<typeof transactionSchema>;
export const pageInfo = object({
  nextCursor: z.string().max(512).optional(),
  hasMore: z.boolean(),
}).openapi("PageInfo");
export const transactionPage = object({ data: z.array(transactionSchema), page: pageInfo }).openapi(
  "TransactionPage",
);
export const keySchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
export const recomputeJob = z
  .object({
    userId: z.uuid(),
    accountIds: z.array(z.uuid()).max(20),
    fromDate: date,
    reason: z.enum(["transactions", "import", "eod", "fx", "recompute"]),
  })
  .strict();
export const importJob = z.object({ userId: z.uuid(), importId: z.uuid() }).strict();
