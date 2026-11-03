import { createHash } from "node:crypto";
import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { pushCreateSchema, pushSubscriptionSchema } from "../contracts.js";
import { isPushEndpoint } from "../push-endpoint.js";

function dto(row: Record<string, unknown>) {
  return pushSubscriptionSchema.parse({
    id: row.id,
    createdAt: z.coerce.date().parse(row.created_at).toISOString(),
    failureCount: row.failure_count,
    ...(row.device_label ? { deviceLabel: row.device_label } : {}),
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    ...(row.last_success_at
      ? { lastSuccessAt: z.coerce.date().parse(row.last_success_at).toISOString() }
      : {}),
  });
}
export function validatePushSubscription(raw: unknown) {
  const data = pushCreateSchema.parse(raw);
  const key = (value: string, size: number) =>
    /^[A-Za-z0-9_-]+={0,2}$/.test(value) && Buffer.from(value, "base64url").length === size;
  if (
    !isPushEndpoint(data.endpoint) ||
    !key(data.keys.p256dh, 65) ||
    Buffer.from(data.keys.p256dh, "base64url")[0] !== 4 ||
    !key(data.keys.auth, 16) ||
    (data.expirationTime != null &&
      (!Number.isSafeInteger(data.expirationTime) ||
        data.expirationTime <= Date.now() ||
        data.expirationTime > 8640000000000000))
  )
    throw new ProblemError("VALIDATION_FAILED");
  return data;
}
export class PushRepository {
  constructor(readonly database: AppDatabase) {}
  list(context: DatabaseContext) {
    return this.database.transaction(context, async (tx) => ({
      data: (
        await tx.execute(sql`SELECT * FROM notifications.push_subscriptions ORDER BY created_at,id`)
      ).rows.map(dto),
    }));
  }
  async create(context: DatabaseContext, raw: unknown, userAgent: string | null, key: string) {
    const data = validatePushSubscription(raw),
      path = "/notifications/push-subscriptions";
    try {
      return await this.database.transaction(context, async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push:${context.userId}`},402))`,
        );
        const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
        await tx.execute(
          sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
        );
        const old = (
          await tx.execute(
            sql`SELECT method,path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key}`,
          )
        ).rows[0];
        if (old) {
          if (old.method !== "POST" || old.path !== path || old.request_hash !== hash)
            throw new ProblemError("IDEMPOTENCY_CONFLICT");
          return pushSubscriptionSchema.parse(old.response_body);
        }
        const existing = (
          await tx.execute(
            sql`SELECT id FROM notifications.push_subscriptions WHERE endpoint=${data.endpoint}`,
          )
        ).rows[0];
        const expiry =
          data.expirationTime == null ? null : new Date(data.expirationTime).toISOString();
        // RLS must never transfer an endpoint owned by another account.
        const rows = existing
          ? await tx.execute(
              sql`UPDATE notifications.push_subscriptions SET p256dh=${data.keys.p256dh},auth=${data.keys.auth},device_label=${data.deviceLabel ?? null},expires_at=${expiry}::timestamptz,user_agent=${userAgent?.slice(0, 512) ?? null},failure_count=0 WHERE id=${existing.id}::uuid RETURNING *`,
            )
          : await tx.execute(
              sql`INSERT INTO notifications.push_subscriptions(user_id,endpoint,p256dh,auth,device_label,expires_at,user_agent) VALUES(${context.userId}::uuid,${data.endpoint},${data.keys.p256dh},${data.keys.auth},${data.deviceLabel ?? null},${expiry}::timestamptz,${userAgent?.slice(0, 512) ?? null}) RETURNING *`,
            );
        const result = dto(rows.rows[0]!);
        await tx.execute(
          sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at) VALUES(${context.userId}::uuid,${key},'POST',${path},${hash},201,${JSON.stringify(result)}::jsonb,now()+interval '24 hours')`,
        );
        return result;
      });
    } catch (error) {
      const pg = error as { code?: string; cause?: { code?: string } };
      if ((pg.code ?? pg.cause?.code) === "23505") throw new ProblemError("NOT_FOUND");
      throw error;
    }
  }
  async require(context: DatabaseContext, id: string) {
    return this.database.transaction(context, async (tx) => {
      if (
        !(
          await tx.execute(
            sql`SELECT id FROM notifications.push_subscriptions WHERE id=${id}::uuid AND failure_count<3 AND (expires_at IS NULL OR expires_at>now())`,
          )
        ).rows[0]
      )
        throw new ProblemError("NOT_FOUND");
    });
  }
  remove(context: DatabaseContext, id: string) {
    return this.database.transaction(context, async (tx) => {
      if (
        !(
          await tx.execute(
            sql`DELETE FROM notifications.push_subscriptions WHERE id=${id}::uuid RETURNING id`,
          )
        ).rows[0]
      )
        throw new ProblemError("NOT_FOUND");
    });
  }
}
