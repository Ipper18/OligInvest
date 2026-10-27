import * as z from "zod/mini";

const uuid = z.uuid();
const decimal = z.string().check(z.regex(/^-?\d{1,14}(\.\d{1,10})?$/));
const time = z.iso.datetime();
const version = { v: z.literal(1) };
const object = z.strictObject;
const money = object({ amount: decimal, currency: z.string().check(z.regex(/^[A-Z]{3}$/)) });
export const streamQuoteSchema = object({
  instrumentId: uuid,
  price: decimal,
  currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  changeRatio: z.optional(z.number()),
  asOf: time,
  delayMinutes: z.int().check(z.gte(0)),
  stale: z.boolean(),
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
  staleReason: z.optional(
    z.enum([
      "market_closed",
      "provider_quota",
      "provider_error",
      "provider_disabled",
      "no_data",
      "eod_only",
      "data_quality_hold",
    ]),
  ),
});
export const realtimeSchemas = {
  ready: object({
    ...version,
    connectionId: uuid,
    heartbeatSeconds: z.literal(25),
    resumed: z.boolean(),
  }),
  ping: object({ ts: time }),
  "market.quotes.updated": object({
    ...version,
    quotes: z.array(streamQuoteSchema).check(z.maxLength(200)),
  }),
  "portfolio.valuation.updated": object({
    ...version,
    accountIds: z.array(uuid),
    valuationAsOf: time,
    reason: z.enum(["quotes", "eod", "fx", "transactions", "import", "recompute"]),
    summary: z.optional(
      object({
        totalValue: money,
        dayChange: money,
        dayChangeRatio: z.number(),
        source: z.string(),
      }),
    ),
  }),
  "portfolio.import.parsed": object({
    ...version,
    importId: uuid,
    status: z.string().check(z.maxLength(40)),
    counts: z.record(z.string().check(z.maxLength(40)), z.int().check(z.gte(0))),
  }),
  "alerts.alert.triggered": object({
    ...version,
    eventId: uuid,
    ruleId: uuid,
    instrumentId: z.optional(uuid),
    message: z.string().check(z.maxLength(1000)),
    triggeredAt: time,
  }),
  "analytics.run.progress": object({
    ...version,
    runId: uuid,
    progress: z.number().check(z.gte(0), z.lte(100)),
    stage: z.string().check(z.maxLength(100)),
  }),
  "analytics.run.completed": object({
    ...version,
    runId: uuid,
    type: z.string().check(z.maxLength(80)),
  }),
  "analytics.run.failed": object({
    ...version,
    runId: uuid,
    errorCode: z.string().check(z.maxLength(80)),
  }),
  "identity.export.ready": object({ ...version, exportId: uuid }),
  "flags.changed": object({
    ...version,
    keys: z.array(z.string().check(z.maxLength(80))).check(z.maxLength(100)),
  }),
  "auth.session.revoked": object({
    ...version,
    reason: z.enum(["revoked", "role_changed", "mfa_reset", "password_reset"]),
  }),
  resync: object({ ...version, reason: z.enum(["gap", "server_restart"]) }),
} as const;
