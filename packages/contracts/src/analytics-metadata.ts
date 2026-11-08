import { z } from "zod";

export const analyticsDataMetaSchema = z
  .object({
    source: z.enum([
      "gpw",
      "gpw_manual",
      "yahoo",
      "stooq_manual",
      "nbp",
      "ecb",
      "finnhub",
      "twelvedata",
      "alphavantage",
      "fred",
      "gdelt",
      "marketaux",
      "broker_import",
      "computed",
      "demo",
      "mixed",
    ]),
    asOf: z.iso.datetime(),
    delayMinutes: z.int().nonnegative(),
    stale: z.boolean(),
    qualityStatus: z.enum(["WARN", "BLOCK"]).optional(),
    staleReason: z
      .enum([
        "market_closed",
        "provider_quota",
        "provider_error",
        "provider_disabled",
        "no_data",
        "eod_only",
        "data_quality_hold",
      ])
      .optional(),
    attribution: z.string().max(200).optional(),
  })
  .strict();

/** Collected by jobs, never trusted from a worker result. Absent in legacy runs. */
export const analyticsSeriesMetadataSchema = z
  .array(
    z
      .object({
        seriesKey: z.string().min(1).max(160),
        meta: analyticsDataMetaSchema,
      })
      .strict(),
  )
  .max(20000);
export type AnalyticsSeriesMetadata = z.infer<typeof analyticsSeriesMetadataSchema>;
