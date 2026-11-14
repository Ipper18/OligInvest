import { createHash } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { DatabaseTransaction } from "@oliginvest/db";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { GDPR_LIMITS, marketError } from "../modules.js";
import { conflictError, rateLimitedError } from "../rate-limited-response.js";
import type { AuthRouteDependencies } from "./routes.js";
import type { AuthService } from "./service.js";
import type { Principal } from "./session.js";

/**
 * GDPR rights (BL-114, FR-07.09, prywatnosc-rodo.md § 7): export request, status and one-time
 * download, account deletion with a 14-day grace period. Every route needs a session with 2FA
 * but not the terms gate (rights must stay available without accepting a new version).
 */
const timestamp = z.string().datetime();
export const dataExportSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["queued", "running", "ready", "failed", "expired"]),
    createdAt: timestamp,
    expiresAt: timestamp.optional(),
    sizeBytes: z.number().int().min(0).optional(),
  })
  .strict()
  .openapi("DataExport", { additionalProperties: true });
export const deletionRequestSchema = z
  .object({
    id: z.uuid(),
    requestedAt: timestamp,
    scheduledFor: timestamp,
    cancelledAt: timestamp.optional(),
  })
  .strict()
  .openapi("DeletionRequest", { additionalProperties: true });
type DataExport = z.infer<typeof dataExportSchema>;
type DeletionRequest = z.infer<typeof deletionRequestSchema>;
type Owner = { userId: string; role: "user" | "pro" | "admin" };
type Client = { ip: string; userAgent: string | undefined };

const EXPORT_PATH = "/api/v1/me/exports";
const EXPORT_REQUEST_HASH = createHash("sha256").update("createDataExport:v1").digest("hex");
const iso = (value: unknown) => z.coerce.date().parse(value).toISOString();
const ipSchema = z.union([z.ipv4(), z.ipv6()]);
/** Audit client fields: an unparsable proxy address is left out rather than rejected. */
const clientFields = (client: Client) => {
  const ip = ipSchema.safeParse(client.ip);
  return {
    ...(ip.success ? { ip: ip.data } : {}),
    ...(client.userAgent ? { userAgent: client.userAgent.slice(0, 512) } : {}),
  };
};
const owner = (principal: Principal): Owner => ({
  userId: principal.user_id,
  role: principal.role,
});

function exportDto(row: Record<string, unknown>): DataExport {
  return dataExportSchema.parse({
    id: row.id,
    status: row.status,
    createdAt: iso(row.created_at),
    ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
    ...(row.size_bytes === null || row.size_bytes === undefined
      ? {}
      : { sizeBytes: Number(row.size_bytes) }),
  });
}
function deletionDto(row: Record<string, unknown>): DeletionRequest {
  return deletionRequestSchema.parse({
    id: row.id,
    requestedAt: iso(row.requested_at),
    scheduledFor: iso(row.scheduled_for),
    ...(row.cancelled_at ? { cancelledAt: iso(row.cancelled_at) } : {}),
  });
}
const exportColumns = sql`id::text, status, created_at, expires_at, size_bytes`;

export class GdprService {
  constructor(readonly service: AuthService) {}

  private get database() {
    return this.service.options.appDatabase;
  }

  private async replay(tx: DatabaseTransaction, user: Owner, key: string) {
    await tx.execute(
      sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
    );
    const old = (
      await tx.execute(
        sql`SELECT method,path,request_hash,response_body FROM platform.idempotency_keys WHERE user_id=${user.userId}::uuid AND key=${key}`,
      )
    ).rows[0];
    if (!old) return null;
    if (
      old.method !== "POST" ||
      old.path !== EXPORT_PATH ||
      old.request_hash !== EXPORT_REQUEST_HASH
    )
      throw new ProblemError("IDEMPOTENCY_CONFLICT");
    return dataExportSchema.parse(old.response_body);
  }

  /** Throws CONFLICT for an export in progress and RATE_LIMITED above the daily cap. */
  private async admissible(tx: DatabaseTransaction) {
    await tx.execute(sql`UPDATE identity.data_exports SET status='failed', content=NULL
      WHERE status IN ('queued','running')
        AND created_at < now() - make_interval(mins => ${GDPR_LIMITS.exportStaleMinutes})`);
    const row = (
      await tx.execute(sql`SELECT
        count(*) FILTER (WHERE status IN ('queued','running'))::int AS active,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS recent
        FROM identity.data_exports`)
    ).rows[0];
    if (Number(row?.active ?? 0) > 0) throw new ProblemError("CONFLICT", { retryAfterSeconds: 60 });
    if (Number(row?.recent ?? 0) >= GDPR_LIMITS.exportsPerDay)
      throw new ProblemError("RATE_LIMITED", { retryAfterSeconds: 3600 });
  }

  async createExport(request: Request, key: string, client: Client) {
    const enqueue = this.service.options.enqueueExport;
    if (!enqueue) throw new ProblemError("SERVICE_UNAVAILABLE");
    this.service.assertOrigin(request);
    const user = owner(await this.service.requireRights(request, true));
    // Read-only pre-check: a rejected or replayed request is not reported as a new export.
    const early = await this.database.transaction(user, async (tx) => {
      const replayed = await this.replay(tx, user, key);
      if (!replayed) await this.admissible(tx);
      return replayed;
    });
    if (early) return this.replayed(early, user, enqueue);
    const monitor = this.service.options.securityMonitor;
    const decision = monitor
      ? await monitor.exportRequested(user, client)
      : await this.recordRequest(user, client);
    const created = await this.database.transaction(user, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gdpr-export:${user.userId}`},114))`,
      );
      const replayed = await this.replay(tx, user, key);
      if (replayed) return { dto: replayed, replayed: true };
      await this.admissible(tx);
      const row = (
        await tx.execute(sql`INSERT INTO identity.data_exports (user_id, status, step_up_after)
          VALUES (${user.userId}::uuid, 'queued', ${decision.requireStepUp ? sql`now()` : sql`NULL`})
          RETURNING ${exportColumns}`)
      ).rows[0];
      if (!row) throw new ProblemError("INTERNAL");
      const dto = exportDto(row);
      await tx.execute(sql`INSERT INTO platform.idempotency_keys
        (user_id,key,method,path,request_hash,status_code,response_body,expires_at)
        VALUES (${user.userId}::uuid,${key},'POST',${EXPORT_PATH},${EXPORT_REQUEST_HASH},202,
          ${JSON.stringify(dto)}::jsonb,now()+interval '24 hours')`);
      return { dto, replayed: false };
    });
    if (created.replayed) return this.replayed(created.dto, user, enqueue);
    try {
      await enqueue({ v: 1, exportId: created.dto.id, userId: user.userId });
    } catch {
      await this.database.transaction(user, (tx) =>
        tx.execute(sql`UPDATE identity.data_exports SET status='failed'
          WHERE id=${created.dto.id}::uuid AND status='queued'`),
      );
      throw new ProblemError("SERVICE_UNAVAILABLE");
    }
    return { dto: created.dto, replayed: false };
  }

  /** A replay re-enqueues a still queued export (same job id, so BullMQ ignores duplicates). */
  private async replayed(
    dto: DataExport,
    user: Owner,
    enqueue: NonNullable<AuthService["options"]["enqueueExport"]>,
  ) {
    const current = await this.status(user, dto.id);
    if (current.status === "queued")
      await enqueue({ v: 1, exportId: dto.id, userId: user.userId }).catch(() => {
        this.service.options.event("gdpr.export_enqueue_failed");
      });
    return { dto: current, replayed: true };
  }

  /** Without the BL-110 monitor (tests, degraded start) the request is still audited. */
  private async recordRequest(user: Owner, client: Client) {
    await this.service.options.audit.record(user, {
      action: "identity.export_requested",
      outcome: "success",
      resourceType: "user",
      resourceId: user.userId,
      ...clientFields(client),
    });
    return { requireStepUp: false };
  }

  private async status(user: Owner, id: string): Promise<DataExport> {
    const row = await this.database.transaction(
      user,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT ${exportColumns} FROM identity.data_exports WHERE id=${id}::uuid`,
          )
        ).rows[0],
    );
    if (!row) throw new ProblemError("NOT_FOUND");
    return exportDto(row);
  }

  async getExport(request: Request, id: string) {
    return this.status(owner(await this.service.requireRights(request)), id);
  }

  async downloadExport(request: Request, id: string) {
    const principal = await this.service.requireRights(request, true);
    const user = owner(principal);
    return this.database.transaction(user, async (tx) => {
      const row = (
        await tx.execute(sql`SELECT content, created_at, step_up_after,
            (status = 'ready' AND content IS NOT NULL AND downloaded_at IS NULL
              AND expires_at > now()) AS available
          FROM identity.data_exports WHERE id=${id}::uuid FOR UPDATE`)
      ).rows[0];
      if (!row || row.available !== true || !(row.content instanceof Buffer))
        throw new ProblemError("NOT_FOUND");
      // BL-110: after a mass-export anomaly only a step-up made after the request counts.
      if (row.step_up_after) {
        const verified = principal.mfa_verified_at?.getTime() ?? 0;
        if (verified <= z.coerce.date().parse(row.step_up_after).getTime())
          throw new ProblemError("STEP_UP_REQUIRED");
      }
      await tx.execute(sql`UPDATE identity.data_exports
        SET downloaded_at=now(), content=NULL, status='expired' WHERE id=${id}::uuid`);
      await this.service.options.audit.recordInTransaction(tx, user, {
        action: "identity.export_downloaded",
        outcome: "success",
        resourceType: "data_export",
        resourceId: id,
      });
      return {
        content: new Uint8Array(row.content),
        fileName: `oliginvest-export-${iso(row.created_at).slice(0, 10)}.zip`,
      };
    });
  }

  async getDeletion(request: Request) {
    const user = owner(await this.service.requireRights(request));
    const row = await this.database.transaction(
      user,
      async (tx) =>
        (
          await tx.execute(sql`SELECT id::text, requested_at, scheduled_for, cancelled_at
            FROM identity.deletion_requests WHERE cancelled_at IS NULL AND completed_at IS NULL
            ORDER BY requested_at DESC, id DESC LIMIT 1`)
        ).rows[0],
    );
    if (!row) throw new ProblemError("NOT_FOUND");
    return deletionDto(row);
  }

  async requestDeletion(request: Request, client: Client) {
    this.service.assertOrigin(request);
    const user = owner(await this.service.requireRights(request, true));
    const dto = await this.database.transaction(user, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gdpr-deletion:${user.userId}`},114))`,
      );
      const active = (
        await tx.execute(sql`SELECT 1 FROM identity.deletion_requests
          WHERE cancelled_at IS NULL AND completed_at IS NULL LIMIT 1`)
      ).rows[0];
      if (active) throw new ProblemError("CONFLICT", { retryAfterSeconds: 86400 });
      const row = (
        await tx.execute(sql`INSERT INTO identity.deletion_requests (user_id, scheduled_for)
          VALUES (${user.userId}::uuid, now() + make_interval(days => ${GDPR_LIMITS.deletionGraceDays}))
          RETURNING id::text, requested_at, scheduled_for, cancelled_at`)
      ).rows[0];
      if (!row) throw new ProblemError("INTERNAL");
      const created = deletionDto(row);
      await this.service.options.audit.recordInTransaction(tx, user, {
        action: "identity.deletion_requested",
        outcome: "success",
        resourceType: "deletion_request",
        resourceId: created.id,
        ...clientFields(client),
        after: { scheduledFor: created.scheduledFor },
      });
      return created;
    });
    await this.service.options.securityMonitor
      ?.deletionRequested(user, { requestId: dto.id, scheduledFor: dto.scheduledFor })
      .catch(() => this.service.options.event("gdpr.deletion_mail_failed"));
    return dto;
  }

  async cancelDeletion(request: Request, client: Client) {
    this.service.assertOrigin(request);
    const user = owner(await this.service.requireRights(request));
    const id = await this.database.transaction(user, async (tx) => {
      const row = (
        await tx.execute(sql`UPDATE identity.deletion_requests SET cancelled_at = now()
          WHERE cancelled_at IS NULL AND completed_at IS NULL AND scheduled_for > now()
          RETURNING id::text`)
      ).rows[0];
      if (!row) throw new ProblemError("NOT_FOUND");
      const requestId = z.uuid().parse(row.id);
      await this.service.options.audit.recordInTransaction(tx, user, {
        action: "identity.deletion_cancelled",
        outcome: "success",
        resourceType: "deletion_request",
        resourceId: requestId,
        ...clientFields(client),
      });
      return requestId;
    });
    await this.service.options.securityMonitor
      ?.deletionCancelled(user, { requestId: id })
      .catch(() => this.service.options.event("gdpr.deletion_mail_failed"));
  }
}

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const idempotencyKey = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .openapi({ pattern: "^[A-Za-z0-9_-]+$" });
const exportParams = z.object({ exportId: z.uuid() }).strict();
const location = { Location: { schema: { type: "string" as const, format: "uri-reference" } } };
const replayedHeader = {
  "Idempotent-Replayed": { schema: { type: "string" as const, enum: ["true"] } },
};

export function mountGdpr(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  const security = [{ sessionCookie: [] }];
  const gdpr = async () => new GdprService(await dependencies.service());
  const client = (context: Parameters<AuthRouteDependencies["clientIp"]>[0]) => ({
    ip: dependencies.clientIp(context),
    userAgent: context.req.header("user-agent"),
  });
  api.openapi(
    createRoute({
      method: "post",
      path: "/me/exports",
      operationId: "createDataExport",
      tags: ["identity"],
      security,
      request: { headers: z.object({ "Idempotency-Key": idempotencyKey }) },
      responses: {
        202: {
          ...json(dataExportSchema, "Przyjęto; postęp zdarzeniem SSE lub odpytywaniem."),
          headers: { ...location, ...replayedHeader },
        },
        401: marketError,
        403: marketError,
        409: conflictError,
        429: rateLimitedError,
      },
    }),
    async (c) => {
      const result = await (await gdpr()).createExport(
        c.req.raw,
        c.req.valid("header")["Idempotency-Key"],
        client(c),
      );
      c.header("Location", `/api/v1/me/exports/${result.dto.id}`);
      c.header("Cache-Control", "no-store");
      if (result.replayed) c.header("Idempotent-Replayed", "true");
      return c.json(result.dto, 202);
    },
    (result) => {
      if (!result.success) throw new ProblemError("VALIDATION_FAILED");
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/me/exports/{exportId}",
      operationId: "getDataExport",
      tags: ["identity"],
      security,
      request: { params: exportParams },
      responses: {
        200: json(dataExportSchema, "Status."),
        401: marketError,
        404: marketError,
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await (await gdpr()).getExport(c.req.raw, c.req.valid("param").exportId), 200);
    },
    (result) => {
      if (!result.success) throw new ProblemError("NOT_FOUND");
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/me/exports/{exportId}/download",
      operationId: "downloadDataExport",
      tags: ["identity"],
      security,
      request: { params: exportParams },
      responses: {
        200: {
          description: "Archiwum ZIP.",
          headers: {
            "Content-Disposition": { schema: { type: "string" as const } },
            "Cache-Control": { schema: { type: "string" as const } },
          },
          content: {
            "application/zip": {
              schema: { type: "string", contentMediaType: "application/zip" },
            },
          },
        },
        401: marketError,
        403: marketError,
        404: marketError,
      },
    }),
    async (c) => {
      const file = await (await gdpr()).downloadExport(c.req.raw, c.req.valid("param").exportId);
      return new Response(file.content, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Content-Length": String(file.content.byteLength),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }) as never;
    },
    (result) => {
      if (!result.success) throw new ProblemError("NOT_FOUND");
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/me/deletion-request",
      operationId: "getDeletionRequest",
      tags: ["identity"],
      security,
      responses: {
        200: json(deletionRequestSchema, "Aktywny wniosek."),
        401: marketError,
        404: marketError,
      },
    }),
    async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await (await gdpr()).getDeletion(c.req.raw), 200);
    },
  );
  api.openapi(
    createRoute({
      method: "post",
      path: "/me/deletion-request",
      operationId: "requestAccountDeletion",
      tags: ["identity"],
      security,
      responses: {
        202: json(deletionRequestSchema, "Zaplanowano usunięcie."),
        401: marketError,
        403: marketError,
        409: conflictError,
      },
    }),
    async (c) => c.json(await (await gdpr()).requestDeletion(c.req.raw, client(c)), 202),
  );
  api.openapi(
    createRoute({
      method: "delete",
      path: "/me/deletion-request",
      operationId: "cancelAccountDeletion",
      tags: ["identity"],
      security,
      responses: { 204: { description: "Anulowano." }, 401: marketError, 404: marketError },
    }),
    async (c) => {
      await (await gdpr()).cancelDeletion(c.req.raw, client(c));
      return c.body(null, 204);
    },
  );
}
