import type { DatabaseContext } from "@oliginvest/db";
import { featureFlagSchema, featureRulesSchema, ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Administration } from "./administration.js";

const reason = z.string().min(5).max(500);
const email = z.email().transform((value) => value.toLowerCase());
const role = z.enum(["user", "pro", "admin"]);
const valuesSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("invite"), email, role, reason }).strict(),
  z
    .object({ command: z.enum(["reset-2fa", "revoke-sessions", "revoke-pats"]), email, reason })
    .strict(),
  z.object({ command: z.enum(["revoke-all-sessions", "revoke-all-pats"]), reason }).strict(),
  z
    .object({
      command: z.literal("queues"),
      action: z.enum(["pause", "resume"]),
      queue: z
        .enum([
          "ingest",
          "import",
          "recompute",
          "alerts",
          "notify",
          "analytics",
          "analytics-results",
          "events",
        ])
        .optional(),
      reason,
    })
    .strict(),
  z
    .object({
      command: z.literal("flag"),
      key: featureFlagSchema.shape.key,
      action: z.enum(["on", "off"]),
      role: role.optional(),
      user: email.optional(),
      reason,
    })
    .strict(),
  z
    .object({
      command: z.literal("maintenance-audit"),
      action: z.enum(["on", "off"]),
      outcome: z.enum(["started", "success", "error"]),
      reason,
    })
    .strict(),
]);

export async function executeAdminCommand(
  admin: Administration,
  input: unknown,
): Promise<{ inviteUrl?: string }> {
  const options = admin.service.options;
  const system: DatabaseContext = { userId: null, role: "system" };
  const parsed = valuesSchema.safeParse(input);
  if (!parsed.success) {
    await options.audit.record(system, { action: "cli.invalid", outcome: "denied" });
    throw new ProblemError("VALIDATION_FAILED");
  }
  const data = parsed.data;
  const action = `cli.${data.command}`;
  if (data.command === "maintenance-audit") {
    await options.audit.record(system, {
      action: `cli.maintenance.${data.action}.${data.outcome}`,
      outcome: data.outcome === "error" ? "error" : "success",
      reason: data.reason,
    });
    return {};
  }
  await options.audit.record(system, {
    action: `${action}.started`,
    outcome: "success",
    reason: data.reason,
  });
  try {
    let invitation: Awaited<ReturnType<Administration["createInvitation"]>> | undefined;
    await options.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      const target =
        "email" in data
          ? (await tx.execute(sql`SELECT id FROM auth.users WHERE lower(email)=${data.email}`))
              .rows[0]
          : undefined;
      if ("email" in data && data.command !== "invite" && !target)
        throw new ProblemError("NOT_FOUND");
      const userId = target ? z.uuid().parse(target.id) : undefined;
      if (data.command === "invite") {
        const inviter = (
          await tx.execute(
            sql`SELECT id FROM auth.users WHERE role='admin' AND email_verified=true AND (banned=false OR ban_expires<now()) ORDER BY created_at,id LIMIT 1`,
          )
        ).rows[0];
        if (!inviter) throw new ProblemError("CONFLICT");
        invitation = await admin.createInvitation(
          { userId: z.uuid().parse(inviter.id), role: "admin" },
          tx,
          { email: data.email, role: data.role },
        );
      } else if (data.command === "reset-2fa") {
        await tx.execute(sql`DELETE FROM auth.sessions WHERE user_id=${userId}::uuid`);
        await tx.execute(sql`DELETE FROM auth.two_factors WHERE user_id=${userId}::uuid`);
        await tx.execute(
          sql`UPDATE auth.users SET two_factor_enabled=false,updated_at=now() WHERE id=${userId}::uuid`,
        );
      } else if (data.command === "revoke-sessions") {
        await tx.execute(sql`DELETE FROM auth.sessions WHERE user_id=${userId}::uuid`);
      } else if (data.command === "revoke-all-sessions") {
        await tx.execute(sql`DELETE FROM auth.sessions`);
      } else if (data.command === "revoke-pats") {
        await tx.execute(
          sql`UPDATE auth.api_keys SET enabled=false,updated_at=now() WHERE reference_id=${userId}`,
        );
      } else if (data.command === "revoke-all-pats") {
        await tx.execute(sql`UPDATE auth.api_keys SET enabled=false,updated_at=now()`);
      } else if (data.command === "flag") {
        if (
          [
            "module.identity",
            "module.notifications",
            "module.market",
            "module.portfolio",
            "module.admin",
          ].includes(data.key)
        )
          throw new ProblemError("FORBIDDEN");
        const selected = data.user
          ? (await tx.execute(sql`SELECT id FROM auth.users WHERE lower(email)=${data.user}`))
              .rows[0]
          : undefined;
        if (data.user && !selected) throw new ProblemError("NOT_FOUND");
        const rules = featureRulesSchema.parse({
          ...(data.role ? { roles: [data.role] } : {}),
          ...(selected ? { users: [selected.id] } : {}),
        });
        await options.appDatabase.transaction(system, (appTx) =>
          appTx.execute(sql`INSERT INTO platform.feature_flags(key,description,enabled,rules,updated_by) VALUES (${data.key},${data.key},${data.action === "on"},${JSON.stringify(rules)}::jsonb,NULL)
          ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled,rules=EXCLUDED.rules,updated_by=NULL,updated_at=now()`),
        );
      }
    });
    if (data.command === "queues") await admin.effects.queues(data.action, data.queue);
    if (data.command === "reset-2fa")
      await admin.effects.resetMail({ email: data.email, issuedAt: new Date().toISOString() });
    if (data.command === "flag") await admin.effects.flagsChanged([data.key]);
    if (invitation?.mail) {
      try {
        await admin.effects.inviteMail(invitation.mail);
      } catch {
        options.event("auth.invitation_delivery_failed");
      }
    }
    await options.audit.record(system, { action, outcome: "success", reason: data.reason });
    return invitation ? { inviteUrl: invitation.value.inviteUrl } : {};
  } catch (error) {
    await options.audit.record(system, {
      action,
      outcome: error instanceof ProblemError ? "denied" : "error",
      reason: data.reason,
    });
    throw error;
  }
}
