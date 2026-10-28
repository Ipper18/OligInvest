import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  deliveryPageSchema,
  type NotificationPreferences,
  preferencesSchema,
} from "../contracts.js";
export const defaultNotificationPreferences = {
  channels: { push: true, email: true },
  emailFallback: true,
  quietHours: null,
};
export async function notificationPreferences(
  tx: DatabaseTransaction,
): Promise<NotificationPreferences> {
  const row = (
    await tx.execute(
      sql`SELECT channels,quiet_hours_start,quiet_hours_end,email_fallback FROM notifications.notification_preferences`,
    )
  ).rows[0];
  return row
    ? preferencesSchema.parse({
        channels: row.channels,
        emailFallback: row.email_fallback,
        quietHours:
          row.quiet_hours_start && row.quiet_hours_end
            ? {
                start: String(row.quiet_hours_start).slice(0, 5),
                end: String(row.quiet_hours_end).slice(0, 5),
              }
            : null,
      })
    : defaultNotificationPreferences;
}
export class NotificationRepository {
  constructor(readonly database: AppDatabase) {}
  preferences(context: DatabaseContext) {
    return this.database.transaction(context, notificationPreferences);
  }
  replace(context: DatabaseContext, input: unknown) {
    const data = preferencesSchema.parse(input);
    return this.database.transaction(context, async (tx) => {
      await tx.execute(
        sql`INSERT INTO notifications.notification_preferences (user_id,channels,quiet_hours_start,quiet_hours_end,email_fallback) VALUES (${context.userId}::uuid,${JSON.stringify(data.channels)}::jsonb,${data.quietHours?.start ?? null}::time,${data.quietHours?.end ?? null}::time,${data.emailFallback}) ON CONFLICT (user_id) DO UPDATE SET channels=excluded.channels,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,email_fallback=excluded.email_fallback,updated_at=now()`,
      );
      return notificationPreferences(tx);
    });
  }
  deliveries(
    context: DatabaseContext,
    query: { limit: number; cursor?: string | undefined; status?: string | undefined },
  ) {
    let cursor: { at: string; id: string; status?: string | undefined } | undefined;
    if (query.cursor) {
      try {
        cursor = z
          .object({ at: z.iso.datetime(), id: z.uuid(), status: z.string().optional() })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
      } catch {
        throw new ProblemError("VALIDATION_FAILED");
      }
      if (cursor.status !== query.status) throw new ProblemError("VALIDATION_FAILED");
    }
    return this.database.transaction(context, async (tx) => {
      const rows = (
        await tx.execute(
          sql`SELECT id::text,kind,channel,status,error,source_ref,created_at,sent_at FROM notifications.notification_deliveries WHERE ${query.status ? sql`status=${query.status}` : sql`true`} AND ${cursor ? sql`(created_at,id)<(${cursor.at}::timestamptz,${cursor.id}::uuid)` : sql`true`} ORDER BY created_at DESC,id DESC LIMIT ${query.limit + 1}`,
        )
      ).rows;
      const hasMore = rows.length > query.limit,
        selected = rows.slice(0, query.limit),
        last = selected.at(-1);
      const at = (value: unknown) => z.coerce.date().parse(value).toISOString();
      return deliveryPageSchema.parse({
        data: selected.map((row) => ({
          id: row.id,
          kind: row.kind,
          channel: row.channel,
          status: row.status,
          createdAt: at(row.created_at),
          ...(row.source_ref ? { sourceRef: row.source_ref } : {}),
          ...(row.error ? { error: row.error } : {}),
          ...(row.sent_at ? { sentAt: at(row.sent_at) } : {}),
        })),
        page: {
          hasMore,
          ...(hasMore && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify({ at: at(last.created_at), id: last.id, status: query.status }),
                ).toString("base64url"),
              }
            : {}),
        },
      });
    });
  }
}
