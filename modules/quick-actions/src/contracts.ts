import { z } from "@hono/zod-openapi";
import { toDecimal } from "@oliginvest/core";
import { metaSchema, summarySchema } from "@oliginvest/mod-market/contracts";
import { currency, decimal, moneySchema, object } from "@oliginvest/mod-portfolio/contracts";
export const quickDecimal = z
  .string()
  .regex(/^\d{1,14}([.,]\d{1,10})?$/)
  .openapi("QuickDecimal");
export const normalizeQuickDecimal = (value: string) =>
  toDecimal(quickDecimal.parse(value).replace(",", ".")).toFixed();
export const ticker = z.string().regex(/^[A-Za-z0-9.-]{1,20}$/);
export const mic = z.string().regex(/^[A-Z0-9]{4}$/);
export const quickTransactionInput = object({
  accountId: z.uuid().optional(),
  accountName: z.string().max(60).optional(),
  ticker,
  mic: mic.optional(),
  side: z.enum(["BUY", "SELL"]),
  quantity: quickDecimal,
  price: quickDecimal,
  currency: currency.optional(),
  tradeDate: z.string().date().optional(),
  fee: quickDecimal.optional(),
  note: z.string().max(200).optional(),
  confirmDuplicate: z.boolean().default(false),
}).openapi("QuickTransactionInput");
export const freshness = object({
  asOf: z.string().datetime(),
  stale: z.boolean(),
  delayMinutes: z.number().int().min(0),
  source: metaSchema.shape.source,
}).openapi("QuickFreshness");
export const incompleteReason = object({
  code: z.enum(["missing_fx_rate", "missing_price", "missing_cost_basis", "missing_day_baseline"]),
  pair: z.string().optional(),
  instrumentId: z.uuid().optional(),
}).openapi("QuickIncompleteReason");
const incompleteFields = { incomplete: z.boolean(), reasons: z.array(incompleteReason) };
const nullableMoney = z.union([moneySchema, z.null()]).openapi({}, { unionPreferredType: "oneOf" });
const portfolioFields = object({
  ...incompleteFields,
  totalValue: nullableMoney,
  dayChange: nullableMoney,
  dayChangeRatio: z.number().nullable(),
  unrealizedPl: nullableMoney,
  topPositions: z
    .array(
      object({
        ticker: z.string(),
        weight: z.number(),
        dayChangeRatio: z.number().nullable().optional(),
      }),
    )
    .max(5)
    .optional(),
});
const mover = object({ ticker: z.string(), changeRatio: z.number() }).openapi("QuickMover");
const todayFields = object({
  ...incompleteFields,
  dayChange: nullableMoney,
  dayChangeRatio: z.number().nullable(),
  best: mover.optional(),
  worst: mover.optional(),
});
const quoteFields = object({
  ticker: z.string(),
  name: z.string(),
  mic: z.string(),
  price: decimal,
  currency,
  changeRatio: z.number().nullable().optional(),
});
export const quickPortfolio = freshness.extend(portfolioFields.shape).strict();
export const quickToday = freshness.extend(todayFields.shape).strict();
export const quickQuote = freshness.extend(quoteFields.shape).strict();
export const quickPortfolioResponse = z
  .intersection(freshness, portfolioFields)
  .openapi("QuickPortfolio");
export const quickTodayResponse = z.intersection(freshness, todayFields).openapi("QuickToday");
export const quickQuoteResponse = z.intersection(freshness, quoteFields).openapi("QuickQuote");
export const quickCreated = object({
  transactionId: z.uuid(),
  accountId: z.uuid(),
  instrument: summarySchema,
  summary: z.string(),
}).openapi("QuickTransactionCreated");
export const quickAlerts = object({
  activeRules: z.number().int(),
  triggered: z.array(
    object({ at: z.string().datetime(), ticker: z.string().optional(), message: z.string() }),
  ),
}).openapi("QuickAlerts");
