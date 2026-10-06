import { z } from "zod";

export const decimalText = z.string().regex(/^-?\d{1,14}(\.\d{1,10})?$/u);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
export const sourceSchema = z.enum([
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
]);
export const staleReasonSchema = z.enum([
  "market_closed",
  "provider_quota",
  "provider_error",
  "provider_disabled",
  "no_data",
  "eod_only",
  "data_quality_hold",
]);
export const dataMetaSchema = z
  .object({
    source: sourceSchema,
    asOf: z.iso.datetime(),
    delayMinutes: z.number().int().nonnegative(),
    stale: z.boolean(),
    staleReason: staleReasonSchema.optional(),
    attribution: z.string().max(200).optional(),
  })
  .strict();
export const quoteSchema = z
  .object({
    instrumentId: z.uuid(),
    price: decimalText,
    currency: currencySchema,
    prevClose: decimalText.optional(),
    change: decimalText.optional(),
    changeRatio: z.number().optional(),
    volume: decimalText.optional(),
    sessionDate: z.iso.date().optional(),
    meta: dataMetaSchema,
    fetchedAt: z.iso.datetime(),
  })
  .strict();
export const barSchema = z
  .object({
    instrumentId: z.uuid(),
    date: z.iso.date(),
    open: decimalText.nullable(),
    high: decimalText.nullable(),
    low: decimalText.nullable(),
    close: decimalText,
    volume: decimalText,
    currency: currencySchema,
    turnover: decimalText.optional(),
    noTrades: z.boolean(),
    adjustmentFactor: decimalText.default("1"),
    meta: dataMetaSchema,
    fetchedAt: z.iso.datetime(),
  })
  .strict();
export const fxSchema = z
  .object({
    base: currencySchema,
    quote: currencySchema,
    date: z.iso.date(),
    rate: decimalText,
    tableNo: z.string().optional(),
    meta: dataMetaSchema,
    fetchedAt: z.iso.datetime(),
  })
  .strict();
export const symbolSchema = z
  .object({
    symbol: z.string().min(1).max(64),
    name: z.string().min(1).max(256),
    mic: z.string().regex(/^[A-Z0-9]{4}$/u),
    currency: currencySchema,
    isin: z
      .string()
      .regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/u)
      .optional(),
    type: z.enum([
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
    ]),
  })
  .strict();
export type Quote = z.infer<typeof quoteSchema>;
export type Bar = z.infer<typeof barSchema>;
export type FxRate = z.infer<typeof fxSchema>;
export type SymbolHit = z.infer<typeof symbolSchema>;
export type DataMeta = z.infer<typeof dataMetaSchema>;
export type Capability = "eodBars" | "intradayQuote" | "fxRate" | "symbolSearch";
export interface ProviderMeta {
  id: DataMeta["source"];
  capabilities: readonly Capability[];
  markets: readonly string[];
  quota: { perMinute?: number; perDay?: number };
  delayMinutes: number;
  license: string;
}
export interface DataProvider {
  meta: ProviderMeta;
  getEodBars?(id: string, range: { from: string; to: string }): Promise<Bar[]>;
  getIntradayQuotes?(ids: string[]): Promise<Quote[]>;
  getFxRate?(base: string, quote: string, date: string): Promise<FxRate[]>;
  searchSymbols?(query: string): Promise<SymbolHit[]>;
}
export class ProviderError extends Error {
  constructor(
    readonly reason: "provider_error" | "provider_quota" | "provider_disabled" | "no_data",
    readonly retryAfterMs = 300_000,
    readonly status?: number,
  ) {
    super(reason);
  }
}
