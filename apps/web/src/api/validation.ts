import * as z from "zod";
export const preferencesSchema = z
  .object({
    baseCurrency: z.literal("PLN"),
    costBasisMethod: z.enum(["fifo", "average"]),
    plView: z.enum(["economic", "tax"]),
    taxDateBasis: z.enum(["settlement", "trade"]),
    taxIncludeFxFee: z.boolean(),
    timezone: z.string(),
    locale: z.enum(["pl-PL", "en-US"]),
    theme: z.enum(["dark", "light", "system"]),
    plPalette: z.enum(["default", "colorblind"]),
  })
  .strict();
export const meSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    emailVerified: z.boolean().optional(),
    role: z.enum(["user", "pro", "admin"]),
    mfa: z
      .object({
        enrolled: z.boolean(),
        sessionVerifiedAt: z.string().datetime().optional(),
        stepUpValidUntil: z.string().datetime().optional(),
      })
      .strict(),
    legal: z
      .object({ termsAcceptanceRequired: z.boolean(), diagnosticsConsent: z.boolean() })
      .strict(),
    permissions: z.array(z.string()),
    features: z.record(z.string(), z.boolean()),
    preferences: preferencesSchema,
    deletionScheduledFor: z.string().datetime().optional(),
  })
  .strict();
export type Me = z.infer<typeof meSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
const version = z.string().regex(/^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(\.[0-9]{1,3})?$/u);
const timestamp = z.string().datetime();
export const legalSchema = z
  .object({
    terms: z
      .object({
        currentVersion: version,
        url: z.string(),
        acceptedVersion: version.optional(),
        acceptedAt: timestamp.optional(),
      })
      .strict(),
    privacyNotice: z
      .object({
        currentVersion: version,
        url: z.string(),
        acknowledgedVersion: version.optional(),
        acknowledgedAt: timestamp.optional(),
      })
      .strict(),
    consents: z
      .object({
        diagnostics: z
          .object({
            granted: z.boolean(),
            version: version.optional(),
            updatedAt: timestamp.optional(),
          })
          .strict(),
      })
      .strict(),
    termsAcceptanceRequired: z.boolean(),
  })
  .strict();
export const problemSchema = z
  .object({
    type: z.string().url(),
    title: z.string(),
    status: z.number(),
    code: z.string(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }).strict())
      .optional(),
  })
  .strict();
const user = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    emailVerified: z.boolean().optional(),
    role: z.enum(["user", "pro", "admin"]),
    twoFactorEnabled: z.boolean(),
  })
  .strict();
const codes = z.array(z.string()).length(10);
const session = z
  .object({
    session: z
      .object({
        id: z.uuid(),
        expiresAt: timestamp,
        mfaVerifiedAt: timestamp.nullable().optional(),
      })
      .strict(),
    user,
    backupCodes: codes.optional(),
  })
  .strict();
const status = z
  .object({ status: z.boolean().optional(), message: z.string().optional() })
  .strict();
export const actionSchemas = {
  signIn: {
    path: "/api/auth/sign-in/email",
    input: z
      .object({ email: z.email(), password: z.string().min(1).max(128), rememberMe: z.boolean() })
      .strict(),
    output: z.object({ twoFactorRedirect: z.boolean().optional(), user: user.optional() }).strict(),
  },
  signOut: { path: "/api/auth/sign-out", input: z.object({}).strict(), output: status },
  totp: {
    path: "/api/auth/two-factor/verify-totp",
    input: z.object({ code: z.string().regex(/^\d{6}$/u) }).strict(),
    output: session,
  },
  backup: {
    path: "/api/auth/two-factor/verify-backup-code",
    input: z.object({ code: z.string().min(8).max(16) }).strict(),
    output: session,
  },
  enable: {
    path: "/api/auth/two-factor/enable",
    input: z.object({ password: z.string().max(128) }).strict(),
    output: z
      .object({ totpURI: z.string().regex(/^otpauth:\/\/totp\//u), backupCodes: codes })
      .strict(),
  },
  preview: {
    path: "/api/v1/invitations/preview",
    input: z.object({ token: z.string().min(32).max(128) }).strict(),
    output: z
      .object({
        emailMasked: z.string(),
        role: z.enum(["user", "pro", "admin"]),
        expiresAt: timestamp,
      })
      .strict(),
  },
  register: {
    path: "/api/auth/sign-up/email",
    input: z
      .object({
        email: z.email(),
        name: z.string().min(1).max(80),
        password: z.string().min(12).max(128),
        invitationToken: z.string().min(32).max(128),
        acceptTerms: z.literal(true),
        termsVersion: version,
        privacyNoticeVersion: version,
        diagnosticsConsent: z.boolean(),
      })
      .strict(),
    output: session,
  },
  requestReset: {
    path: "/api/auth/request-password-reset",
    input: z.object({ email: z.email(), redirectTo: z.literal("/reset-hasla/nowe") }).strict(),
    output: status,
  },
  reset: {
    path: "/api/auth/reset-password",
    input: z
      .object({ newPassword: z.string().min(12).max(128), token: z.string().min(1).max(256) })
      .strict(),
    output: status,
  },
  accept: {
    path: "/api/v1/me/legal/acceptances",
    input: z.object({ termsVersion: version, privacyNoticeVersion: version }).strict(),
    output: legalSchema,
  },
  preferences: {
    path: "/api/v1/me/preferences",
    input: z
      .object({
        theme: z.enum(["dark", "light", "system"]),
        plPalette: z.enum(["default", "colorblind"]),
      })
      .strict(),
    output: preferencesSchema,
  },
  stepUp: {
    path: "/api/v1/me/step-up",
    input: z.object({ code: z.string().regex(/^\d{6}$/) }).strict(),
    output: z.object({ validUntil: z.string().datetime() }).strict(),
  },
} as const;
export type ActionName = keyof typeof actionSchemas;
