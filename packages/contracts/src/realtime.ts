import { z } from "zod";

const uuid = z.uuid();
const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,10})?$/);
const time = z.iso.datetime();
const version = { v: z.literal(1) };
const object = z.strictObject;
const money = object({ amount: decimal, currency: z.string().regex(/^[A-Z]{3}$/) });
export const streamQuoteSchema = object({
  instrumentId: uuid,
  price: decimal,
  currency: z.string().regex(/^[A-Z]{3}$/),
  changeRatio: z.number().optional(),
  asOf: time,
  delayMinutes: z.number().int().nonnegative(),
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
});
export const realtimeSchemas = {
  ready: object({
    ...version,
    connectionId: uuid,
    heartbeatSeconds: z.literal(25),
    resumed: z.boolean(),
  }),
  ping: object({ ts: time }),
  "market.quotes.updated": object({ ...version, quotes: z.array(streamQuoteSchema).max(200) }),
  "portfolio.valuation.updated": object({
    ...version,
    accountIds: z.array(uuid),
    valuationAsOf: time,
    reason: z.enum(["quotes", "eod", "fx", "transactions", "import", "recompute"]),
    summary: object({
      totalValue: money,
      dayChange: money,
      dayChangeRatio: z.number(),
      source: z.string(),
    }).optional(),
  }),
  "portfolio.import.parsed": object({
    ...version,
    importId: uuid,
    status: z.string().max(40),
    counts: z.record(z.string().max(40), z.number().int().nonnegative()),
  }),
  "alerts.alert.triggered": object({
    ...version,
    eventId: uuid,
    ruleId: uuid,
    instrumentId: uuid.optional(),
    message: z.string().max(1000),
    triggeredAt: time,
  }),
  "analytics.run.progress": object({
    ...version,
    runId: uuid,
    progress: z.number().min(0).max(100),
    stage: z.string().max(100),
  }),
  "analytics.run.completed": object({ ...version, runId: uuid, type: z.string().max(80) }),
  "analytics.run.failed": object({ ...version, runId: uuid, errorCode: z.string().max(80) }),
  "identity.export.ready": object({ ...version, exportId: uuid }),
  "flags.changed": object({ ...version, keys: z.array(z.string().max(80)).max(100) }),
  "auth.session.revoked": object({
    ...version,
    reason: z.enum(["revoked", "role_changed", "mfa_reset", "password_reset"]),
  }),
  resync: object({ ...version, reason: z.enum(["gap", "server_restart"]) }),
} as const;
export const realtimeJsonSchemas = Object.fromEntries(
  Object.entries(realtimeSchemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
);
export const persistentEventSchema = object({
  event: z.enum([
    "portfolio.valuation.updated",
    "portfolio.import.parsed",
    "alerts.alert.triggered",
    "analytics.run.progress",
    "analytics.run.completed",
    "analytics.run.failed",
    "identity.export.ready",
  ]),
  data: z.unknown(),
}).superRefine((value, context) => {
  if (!realtimeSchemas[value.event].safeParse(value.data).success)
    context.addIssue({ code: "custom", message: "Invalid event payload" });
  if (
    value.event === "portfolio.valuation.updated" &&
    (value.data as { reason?: string })?.reason === "quotes"
  )
    context.addIssue({ code: "custom", message: "Quote valuation is ephemeral" });
});
