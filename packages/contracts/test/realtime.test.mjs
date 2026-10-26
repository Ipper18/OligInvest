import { expect, test } from "vitest";
import { persistentEventSchema, realtimeJsonSchemas, realtimeSchemas } from "../dist/realtime.js";

const id = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e",
  ts = "2026-10-07T12:00:00Z";
const examples = {
  ready: { v: 1, connectionId: id, heartbeatSeconds: 25, resumed: false },
  ping: { ts },
  "market.quotes.updated": {
    v: 1,
    quotes: [
      {
        instrumentId: id,
        price: "12.34",
        currency: "PLN",
        source: "yahoo",
        asOf: ts,
        delayMinutes: 15,
        stale: false,
      },
    ],
  },
  "portfolio.valuation.updated": { v: 1, accountIds: [id], valuationAsOf: ts, reason: "eod" },
  "portfolio.import.parsed": { v: 1, importId: id, status: "parsed", counts: { valid: 2 } },
  "alerts.alert.triggered": {
    v: 1,
    eventId: id,
    ruleId: id,
    message: "Próg przekroczony.",
    triggeredAt: ts,
  },
  "analytics.run.progress": { v: 1, runId: id, progress: 25, stage: "running" },
  "analytics.run.completed": { v: 1, runId: id, type: "monte_carlo" },
  "analytics.run.failed": { v: 1, runId: id, errorCode: "DATA_QUALITY_HOLD" },
  "identity.export.ready": { v: 1, exportId: id },
  "flags.changed": { v: 1, keys: ["module.education"] },
  "auth.session.revoked": { v: 1, reason: "revoked" },
  resync: { v: 1, reason: "gap" },
};
test.each(Object.entries(examples))(
  "%s validates and exposes a closed JSON Schema",
  (name, data) => {
    expect(realtimeSchemas[name].parse(data)).toEqual(data);
    expect(realtimeSchemas[name].safeParse({ ...data, secret: "unexpected" }).success).toBe(false);
    expect(realtimeJsonSchemas[name].additionalProperties).toBe(false);
  },
);
test("ephemeral events cannot move the durable replay cursor", () => {
  for (const name of [
    "ready",
    "ping",
    "resync",
    "market.quotes.updated",
    "flags.changed",
    "auth.session.revoked",
  ])
    expect(persistentEventSchema.safeParse({ event: name, data: examples[name] }).success).toBe(
      false,
    );
  expect(
    persistentEventSchema.safeParse({
      event: "portfolio.valuation.updated",
      data: { ...examples["portfolio.valuation.updated"], reason: "quotes" },
    }).success,
  ).toBe(false);
});

test("browser validators retain strict nested fields, money formats and numerical bounds", () => {
  const quote = examples["market.quotes.updated"].quotes[0];
  for (const patch of [
    { price: 12 },
    { price: "1e3" },
    { currency: "pln" },
    { delayMinutes: -1 },
    { delayMinutes: 0.5 },
    { secret: "extra" },
    { instrumentId: "invalid" },
    { asOf: "yesterday" },
  ]) {
    expect(
      realtimeSchemas["market.quotes.updated"].safeParse({ v: 1, quotes: [{ ...quote, ...patch }] })
        .success,
    ).toBe(false);
  }
  expect(
    realtimeSchemas["market.quotes.updated"].safeParse({ v: 1, quotes: Array(201).fill(quote) })
      .success,
  ).toBe(false);
  for (const progress of [-1, 101])
    expect(
      realtimeSchemas["analytics.run.progress"].safeParse({
        ...examples["analytics.run.progress"],
        progress,
      }).success,
    ).toBe(false);
  expect(
    realtimeSchemas["flags.changed"].safeParse({ v: 1, keys: Array(101).fill("flag") }).success,
  ).toBe(false);
  expect(
    realtimeSchemas["portfolio.valuation.updated"].safeParse({
      ...examples["portfolio.valuation.updated"],
      summary: {
        totalValue: { amount: "1", currency: "PLN", extra: true },
        dayChange: { amount: "0", currency: "PLN" },
        dayChangeRatio: 0,
        source: "computed",
      },
    }).success,
  ).toBe(false);
});
