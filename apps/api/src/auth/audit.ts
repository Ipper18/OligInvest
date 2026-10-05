import { createHmac } from "node:crypto";
import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

const stateSchema = z
  .object({
    email: z.email().optional(),
    role: z.enum(["user", "pro", "admin"]).optional(),
    status: z.enum(["pending", "paused", "running"]).optional(),
    expiresAt: z.string().datetime().optional(),
    enabled: z.boolean().optional(),
    twoFactorEnabled: z.boolean().optional(),
    count: z.number().int().nonnegative().optional(),
    roles: z.array(z.enum(["user", "pro", "admin"])).optional(),
    users: z.array(z.uuid()).max(50).optional(),
  })
  .strict();
export type AuditState = z.infer<typeof stateSchema>;

const eventSchema = z
  .object({
    action: z.string().regex(/^[a-z][a-z0-9_.-]{1,100}$/u),
    outcome: z.enum(["success", "denied", "error"]),
    resourceId: z.string().max(128).optional(),
    reason: z.string().min(5).max(500).optional(),
    requestId: z.string().max(128).optional(),
    resourceType: z
      .string()
      .regex(/^[a-z][a-z_]{0,63}$/u)
      .optional(),
    ip: z.union([z.ipv4(), z.ipv6()]).optional(),
    userAgent: z.string().max(512).optional(),
    before: stateSchema.nullable().optional(),
    after: stateSchema.optional(),
  })
  .strict();
export class AuditWriter {
  constructor(
    private readonly database: AppDatabase,
    private readonly key: string,
  ) {}
  async record(actor: DatabaseContext, input: z.infer<typeof eventSchema>): Promise<void> {
    const event = eventSchema.parse(input);
    const ref = createHmac("sha256", this.key)
      .update(actor.userId ?? "system")
      .digest("hex");
    await this.database.transaction(actor, (tx) =>
      tx.execute(sql`INSERT INTO platform.audit_log
      (actor_user_id,actor_ref,actor_type,action,resource_id,outcome,request_id,resource_type,ip,user_agent,before,after)
      VALUES (${actor.userId}::uuid,${ref},${actor.role === "admin" ? "admin" : actor.role === "system" || actor.role === "anonymous" ? "system" : "user"},
      ${event.action},${event.resourceId ?? null},${event.outcome},${event.requestId ?? null},
      ${event.resourceType ?? null},${event.ip ?? null}::inet,${event.userAgent ?? null},${JSON.stringify(event.before ?? null)}::jsonb,
      ${JSON.stringify({ ...event.after, ...(event.reason ? { reason: event.reason } : {}) })}::jsonb)`),
    );
  }
}
