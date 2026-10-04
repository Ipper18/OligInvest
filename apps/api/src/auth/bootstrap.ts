import type { AppDatabase, ServiceDatabase } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AuditWriter } from "./audit.js";
import { CURRENT_LEGAL_VERSION } from "./inputs.js";
import { checkPassword, hashPassword, type PasswordChecks } from "./password.js";

export const ownerInput = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    name: z.string().min(1).max(80),
    password: z.string().min(12).max(128),
    reason: z.string().min(5).max(500),
    emailOwnershipConfirmed: z.literal(true),
    termsVersion: z.literal(CURRENT_LEGAL_VERSION),
    privacyNoticeVersion: z.literal(CURRENT_LEGAL_VERSION),
  })
  .strict();

export async function createOwner(
  input: unknown,
  dependencies: {
    database: ServiceDatabase;
    appDatabase: AppDatabase;
    audit: AuditWriter;
    passwordChecks: PasswordChecks;
  },
): Promise<{ id: string }> {
  const actor = { userId: null, role: "system" } as const;
  const parsed = ownerInput.safeParse(input);
  if (!parsed.success) {
    await dependencies.audit.record(actor, { action: "cli.create-owner", outcome: "denied" });
    throw new ProblemError("VALIDATION_FAILED");
  }
  const owner = parsed.data;
  // A durable intent precedes the auth transaction, so audit failure prevents
  // account creation even though auth/app use separate least-privilege pools.
  await dependencies.audit.record(actor, {
    action: "cli.create-owner.started",
    outcome: "success",
    reason: owner.reason,
  });
  try {
    await checkPassword(owner.password, owner, dependencies.passwordChecks);
    const passwordHash = await hashPassword(owner.password);
    const id = await dependencies.database.transaction(async (tx) => {
      // Same lock as all account registration paths, including HTTP invitations.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      if ((await tx.execute(sql`SELECT id FROM auth.users LIMIT 1`)).rows.length)
        throw new ProblemError("CONFLICT");
      const row = (
        await tx.execute(sql`INSERT INTO auth.users(name,email,role,email_verified)
        VALUES (${owner.name},${owner.email},'admin',true) RETURNING id`)
      ).rows[0];
      const userId = z.uuid().parse(row?.id);
      await tx.execute(sql`INSERT INTO auth.accounts(account_id,provider_id,user_id,password)
        VALUES (${userId},'credential',${userId}::uuid,${passwordHash})`);
      return userId;
    });
    // A failed consent write leaves the legal/MFA gates closed. No session is
    // ever created by this command; recovery uses the normal authenticated gate.
    await dependencies.appDatabase.transaction({ userId: id, role: "admin" }, async (tx) => {
      await tx.execute(sql`INSERT INTO identity.consent_events(user_id,document,version,action,source)
        VALUES (${id}::uuid,'terms',${owner.termsVersion},'accepted','sign_up'),
        (${id}::uuid,'privacy_notice',${owner.privacyNoticeVersion},'acknowledged','sign_up')`);
    });
    await dependencies.audit.record(actor, {
      action: "cli.create-owner",
      outcome: "success",
      resourceId: id,
      reason: owner.reason,
    });
    return { id };
  } catch (error) {
    await dependencies.audit.record(actor, {
      action: "cli.create-owner",
      outcome: error instanceof ProblemError ? "denied" : "error",
      reason: owner.reason,
    });
    throw error;
  }
}
