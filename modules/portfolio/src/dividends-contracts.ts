import { z } from "@hono/zod-openapi";
import { metaSchema, summarySchema } from "@oliginvest/mod-market/contracts";
import { currency, decimal, moneySchema, nullableMoney, object } from "./contracts.js";

// Construct only on the API and the results route, never in the portfolio shell.
export function createDividendsSchema() {
  const date = z.string().date();
  const gap = z.enum(["missing_fx", "missing_withholding"]);
  const totals = object({
    payments: z.number().int().min(0),
    grossPln: nullableMoney,
    withholdingTaxPln: nullableMoney,
    netPln: nullableMoney,
    // Null when a taxable payment lacks data or none is taxable; never an assumed 0.
    estimatedTopUpPln: nullableMoney,
    taxablePayments: z.number().int().min(0),
    taxExemptPayments: z.number().int().min(0),
    isComplete: z.boolean(),
  });
  return object({
    currency: z.enum(["PLN"]),
    from: date.nullable(),
    to: date,
    status: z.enum(["ok", "incomplete", "no_data"]),
    rows: z
      .array(
        object({
          transactionId: z.uuid(),
          accountId: z.uuid(),
          instrument: summarySchema,
          payDate: date,
          gross: moneySchema,
          withholdingTax: nullableMoney,
          net: nullableMoney,
          credited: moneySchema,
          grossPln: nullableMoney,
          withholdingTaxPln: nullableMoney,
          netPln: nullableMoney,
          fxRate: z
            .union([
              object({
                rate: decimal,
                rateDate: date,
                source: z.enum(["nbp"]),
                tableNo: z.string().max(40).nullable(),
              }),
              z.null(),
            ])
            .openapi({}, { unionPreferredType: "oneOf" }),
          tax: object({
            status: z.enum(["computed", "not_applicable", "missing_fx", "missing_withholding"]),
            taxDuePln: nullableMoney,
            withholdingCreditPln: nullableMoney,
            estimatedTopUpPln: nullableMoney,
          }),
          gaps: z.array(gap).max(2),
        }),
      )
      .max(5000),
    byYear: z.array(object({ year: z.number().int().min(1900).max(2999), totals })).max(200),
    byInstrument: z
      .array(
        object({
          instrument: summarySchema,
          totals,
          yieldOnCost: object({
            ratio: decimal.nullable(),
            trailingGrossPln: nullableMoney,
            costPln: nullableMoney,
            asOf: date,
            reason: z
              .enum(["no_open_position", "missing_cost", "missing_cost_pln", "missing_fx"])
              .nullable(),
          }),
        }),
      )
      .max(1000),
    totals,
    totalsByCurrency: z
      .array(
        object({
          currency,
          payments: z.number().int().min(1),
          gross: moneySchema,
          withholdingTax: nullableMoney,
          net: nullableMoney,
        }),
      )
      .max(50),
    gaps: z.array(object({ reason: gap, payments: z.number().int().min(1) })).max(2),
    assumptions: object({
      incomeDate: z.literal("payment_date"),
      fxRates: z.literal("nbp_table_a_mid_previous_business_day"),
      plTaxRate: decimal,
      withholdingCredit: z.literal("capped_at_pl_rate"),
      topUp: z.literal("estimate"),
      yieldOnCost: z.literal("trailing_12m_gross_pln_over_open_cost_pln"),
      costBasisMethod: z.literal("fifo"),
    }),
    meta: metaSchema,
  }).openapi("Dividends");
}
export type DividendsResponse = z.infer<ReturnType<typeof createDividendsSchema>>;
