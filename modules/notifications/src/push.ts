import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import type { NotificationJob } from "./dispatch.js";
import { isPushEndpoint } from "./push-endpoint.js";

const subscription = z
  .object({
    id: z.uuid(),
    endpoint: z.url().refine(isPushEndpoint),
    keys: z.object({ p256dh: z.string(), auth: z.string() }).strict(),
  })
  .strict();
export type PushSender = (
  tx: DatabaseTransaction,
  job: NotificationJob,
  now: Date,
) => Promise<{ sent: boolean; retry: boolean }>;
export function pushOptions(kind: NotificationJob["kind"]) {
  return {
    TTL: kind === "alert" ? 3600 : 86400,
    urgency: kind === "alert" || kind === "security" ? ("high" as const) : ("normal" as const),
  };
}
export function createPushSender(
  vapidDetails: { subject: string; publicKey: string; privateKey: string },
  send: typeof webpush.sendNotification = webpush.sendNotification,
): PushSender {
  return async (tx, job, now) => {
    const rows = (
      await tx.execute(
        sql`SELECT id::text,endpoint,p256dh,auth,failure_count FROM notifications.push_subscriptions WHERE failure_count<3 AND (expires_at IS NULL OR expires_at>now()) AND ${job.subscriptionId ? sql`id=${job.subscriptionId}::uuid` : sql`true`}`,
      )
    ).rows;
    let sent = false,
      retry = false;
    for (const row of rows) {
      const parsed = subscription.safeParse({
        id: row.id,
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      });
      if (!parsed.success) {
        await tx.execute(
          sql`DELETE FROM notifications.push_subscriptions WHERE id=${row.id}::uuid`,
        );
        continue;
      }
      try {
        await send(
          parsed.data,
          JSON.stringify({ title: job.subject, body: job.text, url: job.url, tag: job.sourceRef }),
          {
            ...pushOptions(job.kind),
            vapidDetails,
            timeout: 10000,
          },
        );
        sent = true;
        await tx.execute(
          sql`UPDATE notifications.push_subscriptions SET failure_count=0,last_success_at=${now.toISOString()}::timestamptz WHERE id=${row.id}::uuid`,
        );
      } catch (error) {
        // web-push uses https.request, does not follow redirects. Never store provider error bodies.
        const status =
          error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
        if (status === 404 || status === 410)
          await tx.execute(
            sql`DELETE FROM notifications.push_subscriptions WHERE id=${row.id}::uuid`,
          );
        else {
          await tx.execute(
            sql`UPDATE notifications.push_subscriptions SET failure_count=failure_count+1 WHERE id=${row.id}::uuid`,
          );
          retry ||= Number(row.failure_count) + 1 < 3;
        }
      }
    }
    return { sent, retry: !sent && retry };
  };
}
