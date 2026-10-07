import { z } from "@hono/zod-openapi";
import { dataMetaSchema, decimalText, quoteSchema } from "@oliginvest/data-providers";
// Responses allow future additive fields in OpenAPI; actual outbound payloads are validated strictly.
export const object = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict().openapi({ additionalProperties: true });
export const metaSchema = dataMetaSchema.openapi("DataMeta", { additionalProperties: true });
export const apiQuoteSchema = quoteSchema
  .omit({ fetchedAt: true })
  .extend({ meta: metaSchema })
  .strict()
  .openapi("Quote", { additionalProperties: true });
export const instrumentType = z.enum([
  "stock",
  "etf",
  "etc",
  "etn",
  "index",
  "fx",
  "commodity",
  "bond",
  "fund",
  "crypto",
]);
export const summarySchema = object({
  id: z.uuid(),
  ticker: z.string(),
  name: z.string(),
  isin: z
    .string()
    .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/)
    .optional(),
  mic: z.string().regex(/^[A-Z0-9]{4}$/),
  exchangeShortName: z.string().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  type: instrumentType,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  isActive: z.boolean(),
}).openapi("InstrumentSummary");
export const pageSchema = object({
  data: z.array(summarySchema),
  page: object({ hasMore: z.boolean(), nextCursor: z.string().max(512).optional() }),
}).openapi("InstrumentSummaryPage");
export const instrumentDetails = object({
  lotSize: decimalText,
  supportsFractional: z.boolean(),
  assetClass: z
    .enum(["equity", "bond", "cash", "commodity", "real_estate", "crypto", "mixed", "other"])
    .optional(),
  sector: object({ code: z.string(), name: z.string() }).optional(),
  delistedOn: z.string().date().optional(),
  dataSources: object({
    eod: z
      .union([dataMetaSchema.shape.source, z.null()])
      .openapi({}, { unionPreferredType: "oneOf" })
      .optional(),
    intraday: z
      .union([dataMetaSchema.shape.source, z.null()])
      .openapi({}, { unionPreferredType: "oneOf" })
      .optional(),
  }),
  quote: apiQuoteSchema.optional(),
  range52w: object({ low: decimalText, high: decimalText }).optional(),
  avgTurnover20d: object({
    amount: z.string().regex(/^-?\d{1,14}(\.\d{1,8})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).optional(),
});
// Strict validation of merged data, documented using the source's allOf shape.
export const instrumentSchema = summarySchema.extend(instrumentDetails.shape).strict();
export const instrumentResponseSchema = z
  .intersection(summarySchema, instrumentDetails)
  .openapi("Instrument");
export const chartSchema = object({
  instrumentId: z.uuid(),
  interval: z.enum(["15m", "1h", "1d", "1w", "1mo"]).openapi({ default: "1d" }),
  adjusted: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  t: z.array(z.number().int()),
  o: z.array(z.union([decimalText, z.null()]).openapi({}, { unionPreferredType: "oneOf" })),
  h: z.array(z.union([decimalText, z.null()]).openapi({}, { unionPreferredType: "oneOf" })),
  l: z.array(z.union([decimalText, z.null()]).openapi({}, { unionPreferredType: "oneOf" })),
  c: z.array(z.union([decimalText, z.null()]).openapi({}, { unionPreferredType: "oneOf" })),
  v: z.array(z.union([decimalText, z.null()]).openapi({}, { unionPreferredType: "oneOf" })),
  decimated: z.boolean(),
  corporateActions: z
    .array(
      object({
        date: z.string().date(),
        type: z.enum(["split", "reverse_split", "dividend"]),
        ratio: decimalText.optional(),
      }),
    )
    .optional(),
  meta: metaSchema,
}).openapi("OhlcvSeries");
export const statusSchema = object({
  asOf: z.string().datetime(),
  categories: z.array(
    object({
      key: z.enum([
        "gpw_eod",
        "intraday_gpw",
        "intraday_us",
        "fx",
        "news",
        "macro",
        "fundamentals",
      ]),
      status: z.enum(["ok", "degraded", "down", "disabled"]),
      lastSuccessAt: z.string().datetime().optional(),
      staleReason: dataMetaSchema.shape.staleReason,
      message: z.string().optional(),
    }),
  ),
}).openapi("MarketDataStatus");
export const fxResponseSchema = object({
  quote: z.enum(["PLN"]),
  series: z.array(
    object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      items: z.array(
        object({ date: z.string().date(), rate: decimalText, tableNo: z.string().optional() }),
      ),
    }),
  ),
  meta: metaSchema,
}).openapi("FxRatesResponse");
export const marketJobSchema = z
  .object({
    date: z.iso.date().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    instrumentId: z.uuid().optional(),
    query: z.string().min(1).max(64).optional(),
  })
  .strict();
export type Instrument = z.infer<typeof instrumentSchema>;
