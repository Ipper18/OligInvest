import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthConfiguration } from "./config.js";

export const sessionRow = z
  .object({
    id: z.uuid(),
    token: z.string(),
    user_id: z.uuid(),
    role: z.enum(["user", "pro", "admin"]),
    email: z.email(),
    name: z.string(),
    email_verified: z.boolean(),
    two_factor_enabled: z.boolean(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
    expires_at: z.coerce.date(),
    mfa_verified_at: z.coerce.date().nullable(),
    mfa_method: z.enum(["totp", "backup"]).nullable(),
    ip_address: z.string().nullable(),
    user_agent: z.string().nullable(),
  })
  .strict();
export type Principal = z.infer<typeof sessionRow>;
export const SESSION_COOKIE = "__Host-oliginvest.session_token";

export function readSignedCookie(
  request: Request,
  name: string,
  configuration: AuthConfiguration,
): string | null {
  const entries = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${name}=`));
  if (entries.length !== 1) return null;
  let value: string;
  try {
    value = decodeURIComponent(entries[0]?.slice(name.length + 1) ?? "");
  } catch {
    return null;
  }
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const token = value.slice(0, dot);
  const provided = Buffer.from(value.slice(dot + 1));
  if (!configuration.secrets.length) throw new Error("Missing signing secret");
  let valid = 0;
  for (const secret of configuration.secrets) {
    const expected = Buffer.from(createHmac("sha256", secret.value).update(token).digest("base64"));
    valid |= Number(expected.length === provided.length && timingSafeEqual(expected, provided));
  }
  return valid !== 0 ? token : null;
}

export function sessionCookie(
  token: string,
  configuration: AuthConfiguration,
  remember: boolean,
  maximumAge = 604800,
): string {
  const current = configuration.secrets[0];
  if (!current) throw new Error("Missing signing secret");
  const signed = `${token}.${createHmac("sha256", current.value).update(token).digest("base64")}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}; Path=/; Secure; HttpOnly; SameSite=Lax${remember ? `; Max-Age=${maximumAge}` : ""}`;
}

export async function findSession(
  tx: DatabaseTransaction,
  token: string | null,
): Promise<Principal | null> {
  if (!token) return null;
  const row = (
    await tx.execute(sql`SELECT s.id, s.token, s.user_id, s.created_at, s.updated_at, s.expires_at,
    s.mfa_verified_at, s.mfa_method, s.ip_address, s.user_agent, u.role, u.email, u.name, u.email_verified, u.two_factor_enabled
    FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id
    WHERE s.token=${token} AND s.expires_at>now() AND s.created_at>now()-interval '30 days'
      AND (NOT u.banned OR (u.ban_expires IS NOT NULL AND u.ban_expires<=now()))`)
  ).rows[0];
  return row ? sessionRow.parse(row) : null;
}

export function requireMfa(principal: Principal | null): Principal {
  if (!principal) throw new ProblemError("UNAUTHENTICATED");
  if (!principal.two_factor_enabled) throw new ProblemError("MFA_ENROLLMENT_REQUIRED");
  if (!principal.mfa_verified_at || !principal.mfa_method) throw new ProblemError("MFA_REQUIRED");
  return principal;
}
export function requireStepUp(principal: Principal, now = Date.now()): void {
  const verified = principal.mfa_verified_at?.getTime();
  if (
    principal.mfa_method !== "totp" ||
    verified === undefined ||
    verified > now ||
    now - verified > 900_000
  )
    throw new ProblemError("STEP_UP_REQUIRED");
}
export function requireFactorReplacement(principal: Principal, now = Date.now()): void {
  if (principal.mfa_method === "backup") {
    const verified = principal.mfa_verified_at?.getTime();
    if (verified !== undefined && verified <= now && now - verified < 600_000) return;
    throw new ProblemError("STEP_UP_REQUIRED");
  }
  requireStepUp(principal, now);
}
export function publicSession(principal: Principal) {
  return {
    session: {
      id: principal.id,
      expiresAt: principal.expires_at.toISOString(),
      mfaVerifiedAt: principal.mfa_verified_at?.toISOString() ?? null,
    },
    user: {
      id: principal.user_id,
      email: principal.email,
      name: principal.name,
      emailVerified: principal.email_verified,
      role: principal.role,
      twoFactorEnabled: principal.two_factor_enabled,
    },
  };
}
