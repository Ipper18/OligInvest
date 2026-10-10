import { z } from "@hono/zod-openapi";
import { summarySchema } from "@oliginvest/mod-market/contracts";
import {
  currency,
  decimal,
  moneySchema,
  object,
  pageInfo,
  transactionFields,
} from "../contracts.js";

export const rowStatus = z
  .enum(["new", "duplicate", "unsupported", "needs_mapping", "error", "skipped"])
  .openapi("ImportRowStatus");
export const reconciliationSchema = object({
  ok: z.boolean().optional(),
  cash: z
    .array(
      object({ currency, expected: moneySchema, computed: moneySchema, difference: moneySchema }),
    )
    .optional(),
  positions: z
    .array(object({ instrumentId: z.uuid(), expectedQuantity: decimal, computedQuantity: decimal }))
    .optional(),
});
export const importBatchSchema = object({
  id: z.uuid(),
  accountId: z.uuid(),
  source: z.enum(["xtb", "mbank", "generic"]),
  formatDetected: z.string().optional(),
  fileName: z.string(),
  status: z.enum(["uploaded", "parsing", "parsed", "committed", "discarded", "failed"]),
  summary: object({
    rowsTotal: z.number().int().optional(),
    byStatus: z.record(z.string(), z.number().int()).optional(),
    periodFrom: z.iso.date().optional(),
    periodTo: z.iso.date().optional(),
  }).optional(),
  reconciliation: reconciliationSchema.optional(),
  error: z.string().optional(),
  createdAt: z.iso.datetime(),
  parsedAt: z.iso.datetime().optional(),
  committedAt: z.iso.datetime().optional(),
}).openapi("ImportBatch");
export const importRowSchema = object({
  id: z.uuid(),
  rowNumber: z.number().int(),
  sheet: z.string().optional(),
  status: rowStatus,
  statusReason: z.string().optional(),
  raw: z.record(z.string(), z.string().nullable()),
  normalized: transactionFields.optional(),
  instrumentId: z.uuid().optional(),
  candidates: z.array(summarySchema).optional(),
  transactionId: z.uuid().optional(),
}).openapi("ImportRow");
export const resolutionSchema = object({
  action: z.enum(["map_instrument", "skip", "include"]),
  instrumentId: z.uuid().optional(),
  fields: transactionFields.optional(),
  rememberMapping: z.boolean().default(true),
})
  .superRefine((v, ctx) => {
    if (v.action === "map_instrument" && !v.instrumentId)
      ctx.addIssue({ code: "custom", path: ["instrumentId"], message: "Wymagany instrument." });
  })
  .openapi("ImportRowResolution", {
    if: { properties: { action: { const: "map_instrument" } } },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
    then: { required: ["instrumentId"] },
  } as never);
export const importCommitSchema = object({
  acknowledgeDifferences: z.boolean().default(false),
}).openapi("ImportCommitRequest");
export const importUploadSchema = object({
  file: z.string().openapi({ contentMediaType: "application/octet-stream" } as never),
  accountId: z.uuid(),
  source: z.enum(["auto", "xtb", "mbank", "generic"]).default("auto"),
  templateId: z.uuid().optional(),
}).openapi("ImportUpload");
export const importBatchPage = object({ data: z.array(importBatchSchema), page: pageInfo }).openapi(
  "ImportBatchPage",
);
export const importRowPage = object({ data: z.array(importRowSchema), page: pageInfo }).openapi(
  "ImportRowPage",
);
