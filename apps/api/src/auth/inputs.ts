import { z } from "@hono/zod-openapi";
export const legalVersion = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(\.[0-9]{1,3})?$/u)
  .openapi({
    pattern: /^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(\.[0-9]{1,3})?$/u.source.replaceAll("\\/", "/"),
  });
export const CURRENT_LEGAL_VERSION = "2026-09";
export const role = z.enum(["user", "pro", "admin"]);
export const signupInput = z
  .object({
    name: z.string().min(1).max(80),
    email: z.email(),
    password: z.string().min(12).max(128),
    invitationToken: z.string().min(32).max(128),
    acceptTerms: z.literal(true),
    termsVersion: legalVersion,
    privacyNoticeVersion: legalVersion,
    diagnosticsConsent: z.boolean().default(false),
  })
  .strict()
  .openapi("AuthSignUpRequest");
export const signinInput = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().default(true),
  })
  .strict()
  .openapi("AuthSignInRequest");
export const totpInput = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .openapi({ pattern: /^\d{6}$/u.source.replaceAll("\\/", "/") }),
    trustDevice: z.boolean().default(false),
  })
  .strict()
  .openapi("AuthTotpVerifyRequest");
export const backupInput = z
  .object({ code: z.string().min(8).max(16) })
  .strict()
  .openapi("AuthBackupCodeVerifyRequest");
export const passwordInput = z
  .object({ password: z.string().max(128) })
  .strict()
  .openapi("AuthPasswordConfirm");
export const changePasswordInput = z
  .object({
    currentPassword: z.string().max(128),
    newPassword: z.string().min(12).max(128),
    revokeOtherSessions: z.boolean().default(true),
  })
  .strict()
  .openapi("AuthChangePasswordRequest");
export const resetRequestInput = z
  .object({
    email: z.email(),
    redirectTo: z
      .string()
      .regex(/^\/[^/]/u)
      .openapi({ pattern: /^\/[^/]/u.source.replaceAll("\\/", "/") })
      .optional(),
  })
  .strict()
  .openapi("AuthPasswordResetRequest");
export const resetPasswordInput = z
  .object({ newPassword: z.string().min(12).max(128), token: z.string().max(256) })
  .strict()
  .openapi("AuthResetPasswordRequest");
export const revokeInput = z
  .object({ id: z.string().uuid() })
  .strict()
  .openapi("AuthRevokeSessionRequest");
export const stepUpInput = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .openapi({ pattern: /^\d{6}$/u.source.replaceAll("\\/", "/") }),
  })
  .strict()
  .openapi("StepUpRequest");
export const previewInput = z
  .object({
    token: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .openapi({ pattern: /^[A-Za-z0-9_-]+$/u.source.replaceAll("\\/", "/") }),
  })
  .strict()
  .openapi("InvitationPreviewRequest");
export const inviteInput = z
  .object({
    email: z.email(),
    role,
    expiresInHours: z.number().int().min(1).max(168).default(72),
    sendEmail: z.boolean().default(true),
  })
  .strict()
  .openapi("AdminInvitationInput");
export const emptyInput = z.object({}).strict();
export const authInputs: Readonly<Record<string, z.ZodType>> = {
  "/sign-up/email": signupInput,
  "/sign-in/email": signinInput,
  "/sign-out": emptyInput,
  "/get-session": emptyInput,
  "/list-sessions": emptyInput,
  "/request-password-reset": resetRequestInput,
  "/reset-password": resetPasswordInput,
  "/change-password": changePasswordInput,
  "/two-factor/enable": passwordInput,
  "/two-factor/verify-totp": totpInput,
  "/two-factor/verify-backup-code": backupInput,
  "/two-factor/generate-backup-codes": passwordInput,
  "/revoke-session": revokeInput,
  "/revoke-other-sessions": emptyInput,
};
