import { z } from "zod";

const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,10})?$/);
// Valuation uses the instrument class or its user override.
const assetClasses = [
  "equity",
  "bond",
  "commodity",
  "cash",
  "fx",
  "crypto",
  "real_estate",
  "mixed",
  "other",
] as const;
const maxClassLength = Math.max(...assetClasses.map((value) => value.length));
const assetClass = z
  .enum(assetClasses)
  .check(z.maxLength(maxClassLength))
  .meta({ maxLength: maxClassLength });

export const targetWeightSchema = z
  .object({
    instrumentId: z.uuid().optional(),
    assetClass: assetClass.optional(),
    weight: decimal,
  })
  .strict()
  .refine((item) => (item.instrumentId === undefined) !== (item.assetClass === undefined))
  .meta({
    additionalProperties: true,
    oneOf: [{ required: ["instrumentId"] }, { required: ["assetClass"] }],
  });

export const targetAllocationInputSchema = z
  .object({
    name: z.string().min(1).max(60),
    accountId: z.uuid().optional(),
    targets: z.array(targetWeightSchema).min(1).max(50),
    tolerance: decimal.default("0.05"),
  })
  .strict()
  .meta({ additionalProperties: true });

export const targetAllocationSchema = targetAllocationInputSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
