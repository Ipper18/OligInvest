import { z } from "zod";

/**
 * Administrator views of accounts (BL-112, BL-501, BL-509; FR-08.01, FR-08.02). Account, security
 * and activity fields only: no portfolio, transaction, analysis or alert data ever enters these DTOs.
 */
const timestamp = z.iso.datetime();
export const adminRoleSchema = z.enum(["user", "pro", "admin"]);
export const adminRequesterSchema = z.enum(["user", "admin"]);
export const adminPageInfoSchema = z
  .object({ hasMore: z.boolean(), nextCursor: z.string().max(512).optional() })
  .strict();

export const adminUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: adminRoleSchema,
    banned: z.boolean(),
    banReason: z.string().optional(),
    banExpires: timestamp.optional(),
    twoFactorEnabled: z.boolean(),
    emailVerified: z.boolean(),
    createdAt: timestamp,
    lastActiveAt: timestamp.optional(),
    activeSessions: z.number().int(),
    deletionScheduledFor: timestamp.optional(),
    deletionRequestedBy: adminRequesterSchema.optional(),
  })
  .strict();
export const adminUserPageSchema = z
  .object({ data: z.array(adminUserSchema), page: adminPageInfoSchema })
  .strict();

/** Ban requires a reason (OpenAPI `if banned then banReason`). */
export const adminUserPatchSchema = z
  .object({
    role: adminRoleSchema.optional(),
    email: z.email().optional(),
    banned: z.boolean().optional(),
    banReason: z.string().min(5).max(500).optional(),
    banExpires: timestamp.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Empty patch")
  .refine((value) => value.banned !== true || Boolean(value.banReason?.trim()), "Ban reason");

export const adminReasonSchema = z.object({ reason: z.string().min(5).max(500) }).strict();

export const adminInvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: adminRoleSchema,
    invitedBy: z.uuid().optional(),
    status: z.enum(["pending", "used", "expired", "revoked"]),
    expiresAt: timestamp,
    usedAt: timestamp.optional(),
    revokedAt: timestamp.optional(),
    createdAt: timestamp,
  })
  .strict();
export const adminInvitationPageSchema = z
  .object({ data: z.array(adminInvitationSchema), page: adminPageInfoSchema })
  .strict();

export const adminSessionSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    userEmail: z.email(),
    createdAt: timestamp,
    expiresAt: timestamp,
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    mfaVerifiedAt: timestamp.optional(),
  })
  .strict();
export const adminSessionPageSchema = z
  .object({ data: z.array(adminSessionSchema), page: adminPageInfoSchema })
  .strict();

/** `notify` job `auth.email-changed`: one message to the previous and one to the new address. */
export const emailChangedMailSchema = z
  .object({
    email: z.email(),
    audience: z.enum(["previous", "current"]),
    otherEmailMasked: z.string().min(3).max(320),
    issuedAt: z.iso.datetime(),
    locale: z.enum(["pl-PL", "en-US"]).optional(),
  })
  .strict();

export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;
export type AdminInvitation = z.infer<typeof adminInvitationSchema>;
export type AdminSession = z.infer<typeof adminSessionSchema>;
