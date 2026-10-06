import { z } from "@hono/zod-openapi";
import { dataMetaSchema, decimalText, quoteSchema } from "@oliginvest/data-providers";
// Responses allow future additive fields in OpenAPI; actual outbound payloads are validated strictly.
export const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict().openapi({ additionalProperties: true });
export const metaSchema = dataMetaSchema.openapi("DataMeta", { additionalProperties: true });
export const apiQuoteSchema = quoteSchema.omit({ fetchedAt: true }).extend({ meta: metaSchema }).strict().openapi("Quote", { additionalProperties: true });
export const instrumentType = z.enum(["stock", "etf", "etc", "etn", "index", "fx", "commodity", "bond", "fund", "crypto"]);
export const summarySchema = object({ id: z.uuid(), ticker: z.string(), name: z.string(), isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/u).optional(), mic: z.string().regex(/^[A-Z0-9]{4}$/u), exchangeShortName: z.string().optional(), currency: z.string().regex(/^[A-Z]{3}$/u), type: instrumentType, country: z.string().regex(/^[A-Z]{2}$/u).optional(), isActive: z.boolean() }).openapi("InstrumentSummary");
export const pageSchema = object({ data: z.array(summarySchema), page: object({ hasMore: z.boolean(), nextCursor: z.string().max(512).optional() }) }).openapi("InstrumentSummaryPage");
export const instrumentDetails = object({ lotSize: decimalText, supportsFractional: z.boolean(),
  assetClass: z.enum(["equity", "bond", "cash", "commodity", "real_estate", "crypto", "mixed", "other"]).optional(),
  sector: object({ code: z.string(), name: z.string() }).optional(), delistedOn: z.string().date().optional(),
  dataSources: object({ eod: z.union([dataMetaSchema.shape.source, z.null()]).optional(), intraday: z.union([dataMetaSchema.shape.source, z.null()]).optional() }),
  quote: apiQuoteSchema.optional(), range52w: object({ low: decimalText, high: decimalText }).optional(),
  avgTurnover20d: object({ amount: z.string().regex(/^-?\d{1,14}(\.\d{1,8})?$/u), currency: z.string().regex(/^[A-Z]{3}$/u) }).optional(),
});
// Strict validation of merged data, documented using the source's allOf shape.
export const instrumentSchema = summarySchema.extend(instrumentDetails.shape).strict().openapi("Instrument", {
  additionalProperties: true,
  allOf: [z.toJSONSchema(summarySchema), z.toJSONSchema(instrumentDetails)],
});
export const chartSchema = object({ instrumentId: z.uuid(), interval: z.enum(["15m", "1h", "1d", "1w", "1mo"]).default("1d"), adjusted: z.boolean(), currency: z.string().regex(/^[A-Z]{3}$/u),
  t: z.array(z.number().int()), o: z.array(z.union([decimalText, z.null()])), h: z.array(z.union([decimalText, z.null()])), l: z.array(z.union([decimalText, z.null()])), c: z.array(z.union([decimalText, z.null()])), v: z.array(z.union([decimalText, z.null()])), decimated: z.boolean(),
  corporateActions: z.array(object({ date: z.string().date(), type: z.enum(["split", "reverse_split", "dividend"]), ratio: decimalText.optional() })).optional(), meta: metaSchema,
}).openapi("OhlcvSeries");
export const statusSchema = object({ asOf: z.string().datetime(), categories: z.array(object({ key: z.enum(["gpw_eod", "intraday_gpw", "intraday_us", "fx", "news", "macro", "fundamentals"]), status: z.enum(["ok", "degraded", "down", "disabled"]), lastSuccessAt: z.string().datetime().optional(), staleReason: dataMetaSchema.shape.staleReason, message: z.string().optional() })) }).openapi("MarketDataStatus");
export const fxResponseSchema = object({ quote: z.enum(["PLN"]), series: z.array(object({ currency: z.string().regex(/^[A-Z]{3}$/u), items: z.array(object({ date: z.string().date(), rate: decimalText, tableNo: z.string().optional() })) })), meta: metaSchema }).openapi("FxRatesResponse");
export const marketJobSchema = z.object({ date: z.iso.date().optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), instrumentId: z.uuid().optional(), query: z.string().min(1).max(64).optional() }).strict();
export type Instrument = z.infer<typeof instrumentSchema>;
