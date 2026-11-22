import { createHmac } from "node:crypto";
import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const securityIncidentSchema = z
  .object({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    kind: z.enum(["rls", "role", "flag", "limits", "reset-2fa", "email"]),
  })
  .strict();
export type SecurityIncident = z.infer<typeof securityIncidentSchema>;

type IncidentMessages = Record<
  | "securityRlsSubject"
  | "securityRlsBody"
  | "securityAdminChangeSubject"
  | "securityAdminChangeBody"
  | "securityChangeRole"
  | "securityChangeFlag"
  | "securityChangeLimits"
  | "securityChangeResetTwoFactor"
  | "securityChangeEmail",
  string
>;
export type SecurityIncidentNotification = {
  v: 1;
  userId: string;
  kind: "security";
  sourceRef: string;
  channels: ["email"];
  subject: string;
  text: string;
  url: string;
  occurredAt: string;
};
type DeliveryOptions = {
  messages: { "pl-PL": IncidentMessages; "en-US": IncidentMessages };
  formatMessage: (template: string, values: Record<string, string>) => string;
  notify: (id: string, payload: SecurityIncidentNotification) => Promise<void>;
};

/** Shared by API SecurityMonitor and jobs. Retries retain the audit event's sourceRef. */
export async function deliverSecurityIncident(
  database: AppDatabase,
  input: SecurityIncident,
  options: DeliveryOptions,
) {
  const event = securityIncidentSchema.parse(input);
  const admins = await database.transaction(
    { userId: null, role: "system" },
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT id::text FROM identity.user_directory WHERE role='admin' AND NOT banned ORDER BY id`,
        )
      ).rows,
  );
  if (!admins.length) throw new Error("SECURITY_NO_ADMINISTRATOR");
  // One failing recipient must not suppress delivery to the others.
  const results = await Promise.allSettled(
    admins.map(async (row) => {
      const userId = z.uuid().parse(row.id);
      const preferences = await database.transaction(
        { userId, role: "admin" },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT locale,timezone FROM identity.user_preferences WHERE user_id=${userId}::uuid`,
            )
          ).rows[0],
      );
      const locale = preferences?.locale === "en-US" ? "en-US" : "pl-PL";
      const timezone = String(preferences?.timezone ?? "Europe/Warsaw");
      const messages = options.messages[locale];
      const changes = {
        role: messages.securityChangeRole,
        flag: messages.securityChangeFlag,
        limits: messages.securityChangeLimits,
        "reset-2fa": messages.securityChangeResetTwoFactor,
        email: messages.securityChangeEmail,
      };
      await options.notify(`security-incident-${event.id}-${userId}`, {
        v: 1,
        userId,
        kind: "security",
        sourceRef: `security:incident:${event.id}`,
        channels: ["email"],
        subject:
          event.kind === "rls" ? messages.securityRlsSubject : messages.securityAdminChangeSubject,
        text: options.formatMessage(
          event.kind === "rls" ? messages.securityRlsBody : messages.securityAdminChangeBody,
          {
            id: event.id,
            timezone,
            time: new Intl.DateTimeFormat(locale, {
              timeZone: timezone,
              dateStyle: "medium",
              timeStyle: "long",
            }).format(new Date(event.occurredAt)),
            change: event.kind === "rls" ? "" : changes[event.kind],
          },
        ),
        url: "/",
        occurredAt: event.occurredAt,
      });
    }),
  );
  if (results.some((result) => result.status === "rejected"))
    throw new Error("SECURITY_INCIDENT_DELIVERY_FAILED");
}

export type SecurityIncidentReporter = (
  actor: DatabaseContext,
  kind: SecurityIncident["kind"],
) => Promise<void>;
export function createSecurityIncidentReporter(
  database: AppDatabase,
  pseudonymKey: string,
  options: DeliveryOptions,
): SecurityIncidentReporter {
  return async (actor, kind) => {
    const event = await recordSecurityIncident(database, pseudonymKey, actor, kind);
    await deliverSecurityIncident(database, event, options);
  };
}

/** A fresh transaction: no row values, driver errors, query text or administrator input. */
export async function recordSecurityIncident(
  database: AppDatabase,
  pseudonymKey: string,
  actor: DatabaseContext,
  kind: SecurityIncident["kind"],
): Promise<SecurityIncident> {
  const eventKind = securityIncidentSchema.shape.kind.parse(kind);
  return database.transaction(actor, async (tx) => {
    const row = (await tx.execute(sql`SELECT uuidv7()::text AS id, clock_timestamp() AS at`))
      .rows[0];
    const event = securityIncidentSchema.parse({
      id: row?.id,
      occurredAt: z.coerce.date().parse(row?.at).toISOString(),
      kind: eventKind,
    });
    const actorRef = createHmac("sha256", pseudonymKey)
      .update(actor.userId ?? "system")
      .digest("hex");
    await tx.execute(sql`INSERT INTO platform.audit_log
      (id,occurred_at,actor_user_id,actor_ref,actor_type,action,outcome,after)
      VALUES (${event.id}::uuid,${event.occurredAt}::timestamptz,${actor.userId}::uuid,${actorRef},
        ${actor.role === "admin" ? "admin" : actor.userId ? "user" : "system"},
        ${eventKind === "rls" ? "security.rls_violation" : "security.admin_change"},
        ${eventKind === "rls" ? "error" : "success"},${JSON.stringify({ kind: eventKind })}::jsonb)`);
    return event;
  });
}
