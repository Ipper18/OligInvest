import { z } from "@hono/zod-openapi";
import { metaSchema } from "@oliginvest/mod-market/contracts";
import { currency, decimal, moneySchema, nullableMoney, object } from "./contracts.js";

// Construct only on the API and the results route, never in the portfolio shell.
export function createCurrencyExposureSchema() {
  const date = z.string().date();
  const fxRate = object({
    rate: decimal,
    rateDate: date,
    source: z.enum(["nbp", "ecb", "derived"]),
    tableNo: z.string().max(40).nullable(),
  });
  return object({
    currency: z.enum(["PLN"]),
    date,
    status: z.enum(["ok", "incomplete", "no_data"]),
    total: nullableMoney,
    slices: z
      .array(
        object({
          currency,
          status: z.enum(["ok", "missing_price", "missing_fx"]),
          valueInCurrency: nullableMoney,
          securities: nullableMoney,
          cash: nullableMoney,
          value: nullableMoney,
          weight: decimal.nullable(),
          fxRate: z.union([fxRate, z.null()]).openapi({}, { unionPreferredType: "oneOf" }),
        }),
      )
      .max(50),
    decomposition: object({
      rows: z
        .array(
          object({
            currency,
            status: z.enum(["ok", "incomplete"]),
            positions: z.number().int().min(0),
            unrealizedPl: nullableMoney,
            priceEffect: nullableMoney,
            fxEffect: nullableMoney,
          }),
        )
        .max(50),
      total: object({ unrealizedPl: moneySchema, priceEffect: moneySchema, fxEffect: moneySchema }),
      isComplete: z.boolean(),
      exclusions: z
        .array(
          object({
            accountId: z.uuid(),
            instrumentId: z.uuid(),
            currency,
            reason: z.enum(["missing_cost", "missing_price", "missing_fx", "account_currency"]),
          }),
        )
        .max(1000),
    }),
    assumptions: object({
      grouping: z.literal("holding_currency"),
      prices: z.literal("eod_close"),
      fxRates: z.literal("nbp_table_a_mid"),
      view: z.literal("economic"),
      costBasisMethod: z.literal("fifo"),
    }),
    meta: metaSchema,
  }).openapi("CurrencyExposure");
}
export type CurrencyExposureResponse = z.infer<ReturnType<typeof createCurrencyExposureSchema>>;
