import { z } from "zod";
export const onboardingState = z
  .object({
    step: z.string(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    skippedAt: z.iso.datetime({ offset: true }).optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const onboardingUpdate = z
  .object({
    action: z.enum(["advance", "complete", "skip", "restart"]),
    step: z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/)
      .optional(),
  })
  .strict();
