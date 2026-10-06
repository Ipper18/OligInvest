import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError, requirePermission } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AuditState } from "./audit.js";
import { inviteInput } from "./inputs.js";
import type { AuthService } from "./service.js";
import {
  findSession,
  readSignedCookie,
  requireMfa,
  requireStepUp,
  SESSION_COOKIE,
} from "./session.js";

export type AdminEffects = {
  resetMail: (message: { email: string; issuedAt: string }) => Promise<void>;
  inviteMail: (message: {
    email: string;
    token: string;
    expiresAt: string;
    inviterName: string;
  }) => Promise<void>;
  flagsChanged: (keys: readonly string[]) => Promise<void>;
  queues: (action: "pause" | "resume", queue?: string) => Promise<void>;
};
const invitationRow = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["user", "pro", "admin"]),
    invited_by: z.uuid(),
    expires_at: z.coerce.date(),
    created_at: z.coerce.date(),
  })
  .strict();

export class Administration {
  constructor(
    readonly service: AuthService,
    readonly effects: AdminEffects,
  ) {}

  async http<T>(
    request: Request,
    action: string,
    work: (actor: DatabaseContext, tx: DatabaseTransaction) => Promise<T>,
    metadata?: { requestId: string; ip: string },
    describe?: (result: T) => {
      resourceId: string;
      resourceType: string;
      before: AuditState | null;
      after: AuditState;
    },
  ): Promise<T> {
    const options = this.service.options;
    const source = {
      requestId: metadata?.requestId,
      ...(metadata && isIP(metadata.ip) ? { ip: metadata.ip } : {}),
      userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? undefined,
    };
    let actor: DatabaseContext = { userId: null, role: "anonymous" };
    try {
      const initial = await this.service.principal(request);
      if (initial) actor = { userId: initial.user_id, role: initial.role };
      if (request.headers.has("authorization")) throw new ProblemError("FORBIDDEN");
      this.service.assertOrigin(request);
      return await options.database.transaction(async (tx) => {
        // Unrelated auth work must not become an idempotency conflict (R-31).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
        const principal = await findSession(
          tx,
          readSignedCookie(request, SESSION_COOKIE, options.configuration),
        );
        if (!principal) throw new ProblemError("UNAUTHENTICATED");
        requireMfa(principal);
        requireStepUp(principal);
        requirePermission(principal.role, "admin:users");
        if ((await this.service.legal(principal)).termsAcceptanceRequired)
          throw new ProblemError("TERMS_ACCEPTANCE_REQUIRED");
        actor = { userId: principal.user_id, role: principal.role };
        await options.audit.record(actor, {
          action: `${action}.started`,
          outcome: "success",
          ...source,
        });
        const result = await work(actor, tx);
        await options.audit.record(actor, {
          action,
          outcome: "success",
          ...source,
          ...describe?.(result),
        });
        return result;
      });
    } catch (error) {
      await options.audit.record(actor, {
        action,
        outcome: error instanceof ProblemError ? "denied" : "error",
        ...source,
      });
      throw error;
    }
  }

  async createInvitation(
    actor: DatabaseContext,
    tx: DatabaseTransaction,
    input: unknown,
    idempotencyKey?: string,
  ) {
    const data = inviteInput.parse(input);
    const key =
      idempotencyKey === undefined
        ? undefined
        : z
            .string()
            .min(16)
            .max(64)
            .regex(/^[A-Za-z0-9_-]+$/u)
            .parse(idempotencyKey);
    const email = data.email.toLowerCase();
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ ...data, email }))
      .digest("hex");
    const path = "/api/v1/admin/invitations";
    const deriveToken = (version: number, id: string) => {
      const secret = this.service.options.configuration.secrets.find(
        (entry) => entry.version === version,
      );
      if (!secret) throw new ProblemError("SERVICE_UNAVAILABLE");
      return createHmac("sha256", secret.value)
        .update(JSON.stringify(["invitation", actor.userId, key, id]))
        .digest("base64url");
    };
    const created = await this.service.options.appDatabase.transaction(actor, async (appTx) => {
      // HTTP and CLI hold the same advisory lock across lookup and creation.
      if (key) {
        const lockKey = JSON.stringify(["adminCreateInvitation", actor.userId, key]);
        await appTx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
        const cached = (
          await appTx.execute(
            sql`SELECT method,path,request_hash,response_body FROM platform.idempotency_keys WHERE key=${key} AND expires_at>now()`,
          )
        ).rows[0];
        if (cached) {
          if (
            cached.method !== "POST" ||
            cached.path !== path ||
            cached.request_hash !== requestHash
          )
            throw new ProblemError("IDEMPOTENCY_CONFLICT");
          const stored = z
            .object({ row: invitationRow, version: z.number().int().nonnegative() })
            .strict()
            .parse(cached.response_body);
          return {
            row: stored.row,
            token: deriveToken(stored.version, stored.row.id),
            replayed: true,
          };
        }
      }
      const user = await tx.execute(sql`SELECT id FROM auth.users WHERE lower(email)=${email}`);
      if (user.rows.length) throw new ProblemError("CONFLICT");
      const count = await tx.execute(sql`SELECT count(*)::int AS count FROM auth.users`);
      if (Number(count.rows[0]?.count) >= 10) throw new ProblemError("CONFLICT");
      const active = await appTx.execute(
        sql`SELECT id FROM identity.invitations WHERE email=${email} AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      );
      if (active.rows.length) throw new ProblemError("CONFLICT");
      const id = z.uuid().parse((await appTx.execute(sql`SELECT uuidv7() AS id`)).rows[0]?.id);
      const version = this.service.options.configuration.secrets[0]?.version;
      if (version === undefined) throw new ProblemError("SERVICE_UNAVAILABLE");
      const token = key ? deriveToken(version, id) : randomBytes(32).toString("base64url");
      const result =
        await appTx.execute(sql`INSERT INTO identity.invitations(id,email,role,token_hash,invited_by,expires_at)
        VALUES (${id}::uuid,${email},${data.role},${createHash("sha256").update(token).digest("hex")},${actor.userId}::uuid,now()+${data.expiresInHours}*interval '1 hour')
        RETURNING id,email,role,invited_by,expires_at,created_at`);
      const row = invitationRow.parse(result.rows[0]);
      if (key) {
        await appTx.execute(
          sql`DELETE FROM platform.idempotency_keys WHERE key=${key} AND expires_at<=now()`,
        );
        await appTx.execute(
          sql`INSERT INTO platform.idempotency_keys(user_id,key,method,path,request_hash,status_code,response_body,expires_at) VALUES (${actor.userId}::uuid,${key},'POST',${path},${requestHash},201,${JSON.stringify({ row, version })}::jsonb,now()+interval '24 hours')`,
        );
      }
      return { row, token, replayed: false };
    });
    const { row, token, replayed } = created;
    const url = new URL("/rejestracja", this.service.options.configuration.origin);
    url.hash = `t=${token}`;
    const inviterName =
      !replayed && data.sendEmail
        ? z
            .string()
            .parse(
              (await tx.execute(sql`SELECT name FROM auth.users WHERE id=${actor.userId}::uuid`))
                .rows[0]?.name,
            )
        : "";
    return {
      value: {
        id: row.id,
        email: row.email,
        role: row.role,
        invitedBy: row.invited_by,
        status: "pending" as const,
        expiresAt: row.expires_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        inviteUrl: url.href,
      },
      replayed,
      mail:
        !replayed && data.sendEmail
          ? { email, token, expiresAt: row.expires_at.toISOString(), inviterName }
          : undefined,
    };
  }
}
