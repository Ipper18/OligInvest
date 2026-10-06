import { z } from "zod";
export const twoFactorResetMailSchema = z
  .object({ email: z.email(), issuedAt: z.iso.datetime() })
  .strict();
export const invitationMailSchema = z
  .object({
    email: z.email(),
    token: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u),
    expiresAt: z.iso.datetime(),
    inviterName: z.string().min(1).max(80),
  })
  .strict();

export const authMailSchema = z
  .object({
    email: z.email(),
    token: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/u),
    issuedAt: z.iso.datetime(),
  })
  .strict();
export const authSecurityEventSchema = z
  .object({
    userId: z.uuid(),
    kind: z.enum(["two_factor_recovery_started", "two_factor_recovered"]),
    occurredAt: z.iso.datetime(),
  })
  .strict();
