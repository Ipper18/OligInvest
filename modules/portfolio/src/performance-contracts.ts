import { z } from "@hono/zod-openapi";
import { returnFiguresSchema } from "@oliginvest/contracts";
import { PERIOD_KEYS } from "@oliginvest/core";
import { metaSchema } from "@oliginvest/mod-market/contracts";
import { currency, moneySchema, object } from "./contracts.js";

// Constructed only by the API and the isolated performance route.
export function createPerformanceSchema() {
  const date = z.string().date();
  const returnFigures = object(returnFiguresSchema.shape).openapi("ReturnFigures");
  return object({
    currency,
    from: date,
    to: date,
    total: returnFigures,
    periods: z.array(returnFigures.extend({ key: z.enum(PERIOD_KEYS) }).strict()),
    benchmark: object({
      instrumentId: z.uuid().optional(),
      name: z.string().optional(),
      twr: z.number().nullable().optional(),
      sameFlowsEndValue: moneySchema.optional(),
      sameFlowsXirr: z.number().nullable().optional(),
    }).optional(),
    assumptions: object({ flowTiming: z.literal("start_of_day"), dayCount: z.literal("ACT/365") }),
    meta: metaSchema,
  }).openapi("Performance");
}
