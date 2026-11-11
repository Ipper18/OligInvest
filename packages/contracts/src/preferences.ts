import { z } from "zod";

export const preferencesSchema = z
  .object({
    baseCurrency: z.literal("PLN"),
    costBasisMethod: z.enum(["fifo", "average"]),
    plView: z.enum(["economic", "tax"]),
    taxDateBasis: z.enum(["settlement", "trade"]),
    taxIncludeFxFee: z.boolean(),
    timezone: z.string(),
    locale: z.enum(["pl-PL", "en-US"]),
    theme: z.enum(["system", "light", "dark"]),
    plPalette: z.enum(["default", "colorblind"]),
  })
  .strict();

export const preferencesPatchSchema = preferencesSchema
  .omit({ baseCurrency: true })
  .partial()
  .extend({ timezone: z.string().min(1).max(64).optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0)
  .meta({ minProperties: 1 });

export type Preferences = z.infer<typeof preferencesSchema>;

export const costBasisContextSchema = z
  .object({
    method: z.enum(["fifo", "average"]),
    analytical: z.boolean(),
  })
  .strict();

export const preferencesJsonSchemas = {
  Preferences: z.toJSONSchema(preferencesSchema),
  PreferencesPatch: z.toJSONSchema(preferencesPatchSchema),
  CostBasisContext: z.toJSONSchema(costBasisContextSchema),
};
