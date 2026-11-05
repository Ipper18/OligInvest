import { z } from "zod";

export const stressScenarioKeySchema = z.string().regex(/^[a-z0-9_]{3,40}$/);
const shockSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("index_shock"),
      instrumentId: z.uuid(),
      shock: z.number().min(-0.9).max(0.9),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fx_shock"),
      currency: z.enum(["USD", "EUR"]),
      shock: z.number().min(-0.9).max(0.9),
    })
    .strict(),
  z
    .object({
      kind: z.literal("correlation_shock"),
      correlation: z.number().min(0).max(1).optional(),
    })
    .strict(),
]);
const shocksSchema = z.object({ items: z.array(shockSchema).min(1).max(10) }).strict();

// The flat wire shape mirrors StressScenarioInput. Kind-specific checks are runtime invariants.
const scenarioShape = {
  name: z.string().max(80),
  kind: z.enum(["historical", "hypothetical"]),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  shocks: z.record(z.string(), z.unknown()).optional(),
  description: z.string().max(1000),
  enabled: z.boolean(),
};
// Also used for the audit's previous state: an older invalid configuration must remain repairable.
export const stressScenarioSchema = z
  .object({ key: stressScenarioKeySchema, ...scenarioShape })
  .strict();
export const stressScenarioInputSchema = z
  .object(scenarioShape)
  .strict()
  .superRefine((value, context) => {
    const invalid = (path: string[]) =>
      context.addIssue({
        code: "custom",
        path,
        message: "Nieprawidłowa konfiguracja scenariusza.",
      });
    if (value.kind === "historical") {
      if (!value.startDate) invalid(["startDate"]);
      if (!value.endDate) invalid(["endDate"]);
      if (
        value.startDate &&
        value.endDate &&
        (value.startDate >= value.endDate ||
          (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86_400_000 > 1096)
      )
        invalid(["endDate"]);
      if (value.shocks && Object.keys(value.shocks).length) invalid(["shocks"]);
    } else {
      if (value.startDate !== undefined) invalid(["startDate"]);
      if (value.endDate !== undefined) invalid(["endDate"]);
      if (!shocksSchema.safeParse(value.shocks).success) invalid(["shocks"]);
    }
  });
export type StressScenarioInput = z.infer<typeof stressScenarioInputSchema>;
export type StressScenario = z.infer<typeof stressScenarioSchema>;
