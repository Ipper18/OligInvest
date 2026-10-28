import type { AppDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { channelSchema } from "./contracts.js";
import { deliveryChannels, quietUntil } from "./delivery-policy.js";
import { notificationPreferences } from "./server/repository.js";

export const notificationJobSchema = z
  .object({
    v: z.literal(1),
    userId: z.uuid(),
    kind: z.enum(["alert", "security", "system"]),
    sourceRef: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9:-]+$/),
    channels: z.array(channelSchema).min(1).max(2),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(4000),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export async function dispatchNotification(
  database: AppDatabase,
  input: unknown,
  send: (email: string, subject: string, text: string, security: boolean) => Promise<void>,
  now = new Date(),
  alertEnabled = true,
) {
  const data = notificationJobSchema.parse(input),
    context = { userId: data.userId, role: "user" as const };
  const result = await database.transaction(context, async (tx) => {
    // Group alert:ruleId:eventId. Other sources deduplicate by their complete sourceRef.
    const group =
      data.kind === "alert" ? data.sourceRef.split(":").slice(0, 2).join(":") : data.sourceRef;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notify:${data.userId}:${group}`},403))`,
    );
    const recipient = (
      await tx.execute(
        sql`SELECT email,banned FROM identity.user_directory WHERE id=${data.userId}::uuid`,
      )
    ).rows[0];
    if (!recipient || recipient.banned) return {};
    const preferences = await notificationPreferences(tx);
    const channels =
      data.kind === "security"
        ? ["email"]
        : data.kind === "alert" && !alertEnabled
          ? []
          : deliveryChannels(data.channels, preferences, false);
    // Push transport is introduced in BL-402. Never report a fake push delivery.
    const channel = "email";
    await tx.execute(
      sql`INSERT INTO notifications.notification_deliveries(user_id,kind,source_ref,channel,status,created_at) SELECT ${data.userId}::uuid,${data.kind},${data.sourceRef},${channel},${channels.includes(channel) ? "queued" : "skipped"},${data.occurredAt}::timestamptz WHERE NOT EXISTS (SELECT 1 FROM notifications.notification_deliveries WHERE source_ref=${data.sourceRef} AND channel=${channel})`,
    );
    const delivery = (
      await tx.execute(
        sql`SELECT id::text,status FROM notifications.notification_deliveries WHERE source_ref=${data.sourceRef} AND channel=${channel} FOR UPDATE`,
      )
    ).rows[0];
    if (!delivery || ["sent", "skipped"].includes(String(delivery.status))) return {};
    if (!channels.includes(channel)) {
      await tx.execute(
        sql`UPDATE notifications.notification_deliveries SET status='skipped',error='CHANNEL_DISABLED' WHERE id=${delivery.id}::uuid`,
      );
      return {};
    }
    const timezone = String(
      (await tx.execute(sql`SELECT timezone FROM identity.user_preferences`)).rows[0]?.timezone ??
        "Europe/Warsaw",
    );
    const until =
      data.kind === "security"
        ? null
        : quietUntil(now.toISOString(), timezone, preferences.quietHours);
    if (until) return { delayUntil: Date.parse(until) };
    if (data.kind === "alert") {
      const latest = (
        await tx.execute(
          sql`SELECT id::text FROM notifications.notification_deliveries WHERE kind='alert' AND channel='email' AND source_ref LIKE ${`${group}:%`} ORDER BY created_at DESC,id DESC LIMIT 1`,
        )
      ).rows[0];
      if (latest?.id !== delivery.id) {
        await tx.execute(
          sql`UPDATE notifications.notification_deliveries SET status='skipped',error='COALESCED' WHERE id=${delivery.id}::uuid`,
        );
        return {};
      }
    }
    try {
      await send(
        z.email().parse(recipient.email),
        data.subject,
        data.text,
        data.kind === "security",
      );
    } catch (error) {
      // A depleted quota is postponement, not failed delivery. SMTP details never enter SQL/logs.
      if (error instanceof Error && error.message === "MAIL_QUOTA_EXCEEDED" && "retryAt" in error)
        return { delayUntil: z.number().parse(error.retryAt) };
      await tx.execute(
        sql`UPDATE notifications.notification_deliveries SET status='failed',error='DELIVERY_FAILED' WHERE id=${delivery.id}::uuid`,
      );
      return { failed: true };
    }
    await tx.execute(
      sql`UPDATE notifications.notification_deliveries SET status='sent',error=NULL,sent_at=${now.toISOString()}::timestamptz WHERE id=${delivery.id}::uuid`,
    );
    return {};
  });
  if (result.failed) throw new Error("NOTIFICATION_DELIVERY_FAILED");
  return result;
}
