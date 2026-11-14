import { z } from "@hono/zod-openapi";
import { metaSchema } from "@oliginvest/mod-market/contracts";
import { object } from "./contracts.js";

// Construct only on the API and the results route, never in the portfolio shell.
export function createDrawdownSchema() {
  const date = z.string().date();
  const nullableDate = z.union([date, z.null()]).openapi({}, { unionPreferredType: "oneOf" });
  const rate = z.string().regex(/^-?\d+(\.\d+)?$/);
  return object({
    currency: z.enum(["PLN"]),
    from: date,
    to: date,
    status: z.enum(["ok", "no_data", "incomplete"]),
    maxDrawdown: rate.nullable(),
    peakDate: nullableDate,
    troughDate: nullableDate,
    recoveryDate: nullableDate,
    durationDays: z.number().int().min(0).nullable(),
    recoveryDays: z.number().int().min(0).nullable(),
    underwater: object({
      t: z.array(z.number().int()).max(3000),
      drawdown: z.array(rate).max(3000),
    }),
    decimated: z.boolean(),
    meta: metaSchema,
  }).openapi("Drawdown");
}
export type Drawdown = z.infer<ReturnType<typeof createDrawdownSchema>>;
