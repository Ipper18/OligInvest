import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { DatabaseTransaction } from "@oliginvest/db";
import { betterAuth } from "better-auth";
import type { SecretConfig } from "better-auth/crypto";
import { admin, haveIBeenPwned, twoFactor } from "better-auth/plugins";
import {
  authAccounts,
  authApiKeys,
  authRateLimits,
  authSessions,
  authTwoFactors,
  authUsers,
  authVerifications,
} from "../modules.js";
import { hashPassword, verifyPassword } from "./password.js";

export type AuthConfiguration = Readonly<{
  origin: string;
  secrets: readonly { version: number; value: string }[];
  trustedProxies: readonly string[];
  sendReset: (message: { email: string; token: string }) => Promise<void>;
}>;

// Only the facade calls this handler, after strict validation and authorization.
// Each instance uses a single verified oliginvest_auth transaction, including hooks.
export interface Auth {
  handler(request: Request): Promise<Response>;
  $context: Promise<{ secret: string; secretConfig: string | SecretConfig }>;
}
export function createAuth(
  transaction: DatabaseTransaction,
  configuration: AuthConfiguration,
): Auth {
  return betterAuth({
    appName: "OligInvest",
    baseURL: configuration.origin,
    basePath: "/api/auth",
    secrets: [...configuration.secrets],
    trustedOrigins: [configuration.origin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    database: drizzleAdapter(transaction, {
      provider: "pg",
      transaction: true,
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        twoFactor: authTwoFactors,
        apikey: authApiKeys,
        rateLimit: authRateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, token }) =>
        configuration.sendReset({ email: user.email, token }),
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: {
      expiresIn: 604800,
      updateAge: 86400,
      cookieCache: { enabled: false },
      additionalFields: {
        mfaVerifiedAt: { type: "date", required: false, input: false },
        mfaMethod: { type: "string", required: false, input: false },
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "lax", path: "/" },
      cookies: Object.fromEntries(
        [
          "session_token",
          "dont_remember",
          "two_factor",
          "session_data",
          "account_data",
          "trust_device",
        ].map((name) => [name, { name: `__Host-oliginvest.${name}` }]),
      ),
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: [...configuration.trustedProxies],
      },
    },
    plugins: [
      twoFactor({
        issuer: "OligInvest",
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: "encrypted" },
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      apiKey({ defaultPrefix: "oli_pat_", disableKeyHashing: false }),
      // The facade invokes the plugin's isPasswordCompromised helper before opening
      // the SQL transaction, implementing AUTH's offline fallback on provider outage.
      haveIBeenPwned({ paths: [] }),
    ],
  });
}
