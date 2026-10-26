import * as z from "zod";
import { realtimeSchemas } from "./realtime-schemas.js";

export * from "./realtime-schemas.js";

const object = z.strictObject;
export const realtimeJsonSchemas: Record<string, z.core.JSONSchema.BaseSchema> = Object.fromEntries(
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
