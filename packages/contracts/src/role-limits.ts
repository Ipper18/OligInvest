import { z } from "zod";

/** Internal snapshot; HTTP refusals retain the existing Problem contract. */
export const dailyRoleQuotaSchema = z
  .object({
    role: z.enum(["user", "pro", "admin"]),
    limit: z.number().int().nonnegative().nullable(),
    used: z.number().int().nonnegative(),
    observedAt: z.iso.datetime(),
    resetAt: z.iso.datetime(),
  })
  .strict()
  .refine((value) => Date.parse(value.resetAt) > Date.parse(value.observedAt));

export type DailyRoleQuota = z.infer<typeof dailyRoleQuotaSchema>;
