import type { DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Account operations shared by `pnpm admin:*` (BL-111) and the /admin panel (BL-112, BL-501,
 * BL-509). They run in the auth-role transaction of the caller, which already holds the global
 * auth advisory lock and writes the audit entry; nothing here reads domain (financial) tables.
 */
const role = z.enum(["user", "pro", "admin"]);
const accountRow = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role,
    banned: z.boolean(),
    ban_expires: z.coerce.date().nullable(),
    two_factor_enabled: z.boolean(),
  })
  .strict();
export type AccountRow = z.infer<typeof accountRow>;

/**
 * Locks the account row against concurrent changes for the rest of the transaction; unknown id →
 * NOT_FOUND. `FOR NO KEY UPDATE`, not `FOR UPDATE`: the app-role transaction of the same request
 * inserts rows referencing the account (deletion request), and their key-share check must not wait.
 */
export async function lockAccount(tx: DatabaseTransaction, userId: string): Promise<AccountRow> {
  const row = (
    await tx.execute(sql`SELECT id,email,name,role,banned,ban_expires,two_factor_enabled
      FROM auth.users WHERE id=${userId}::uuid FOR NO KEY UPDATE`)
  ).rows[0];
  if (!row) throw new ProblemError("NOT_FOUND");
  return accountRow.parse(row);
}

/** Active administrators other than `except` (a ban that has expired no longer counts). */
export async function otherActiveAdmins(tx: DatabaseTransaction, except: string): Promise<number> {
  const row = (
    await tx.execute(sql`SELECT count(*)::int AS count FROM auth.users
      WHERE role='admin' AND id<>${except}::uuid
        AND (NOT banned OR (ban_expires IS NOT NULL AND ban_expires<=now()))`)
  ).rows[0];
  return z.number().int().parse(row?.count);
}

/** Deletes every session of the account; the next request and the SSE recheck (25 s) end it. */
export async function revokeAccountSessions(
  tx: DatabaseTransaction,
  userId: string,
): Promise<number> {
  const result = await tx.execute(sql`DELETE FROM auth.sessions WHERE user_id=${userId}::uuid`);
  return result.rowCount ?? 0;
}

/** Removes the TOTP secret and backup codes and ends all sessions; the MFA gate applies again. */
export async function resetAccountTwoFactor(
  tx: DatabaseTransaction,
  userId: string,
): Promise<{ before: boolean }> {
  const current = (
    await tx.execute(sql`SELECT two_factor_enabled FROM auth.users WHERE id=${userId}::uuid`)
  ).rows[0];
  if (!current) throw new ProblemError("NOT_FOUND");
  await revokeAccountSessions(tx, userId);
  await tx.execute(sql`DELETE FROM auth.two_factors WHERE user_id=${userId}::uuid`);
  await tx.execute(
    sql`UPDATE auth.users SET two_factor_enabled=false,updated_at=now() WHERE id=${userId}::uuid`,
  );
  return { before: z.boolean().parse(current.two_factor_enabled) };
}

/** `j***@e***.pl`: enough for the owner of an address to recognise it, not to reveal it. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const suffix = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${suffix}`;
}
