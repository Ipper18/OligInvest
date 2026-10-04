import { createHash, randomBytes } from "node:crypto";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError, requirePermission } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
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
    requestId?: string,
  ): Promise<T> {
    const options = this.service.options;
    let actor: DatabaseContext = { userId: null, role: "anonymous" };
    try {
      const initial = await this.service.principal(request);
      if (initial) actor = { userId: initial.user_id, role: initial.role };
      if (request.headers.has("authorization")) throw new ProblemError("FORBIDDEN");
      this.service.assertOrigin(request);
      return await options.database.transaction(async (tx) => {
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
          requestId,
        });
        const result = await work(actor, tx);
        await options.audit.record(actor, { action, outcome: "success", requestId });
        return result;
      });
    } catch (error) {
      await options.audit.record(actor, {
        action,
        outcome: error instanceof ProblemError ? "denied" : "error",
        requestId,
      });
      throw error;
    }
  }

  async createInvitation(actor: DatabaseContext, tx: DatabaseTransaction, input: unknown) {
    const data = inviteInput.parse(input);
    const email = data.email.toLowerCase();
    const user = await tx.execute(sql`SELECT id FROM auth.users WHERE lower(email)=${email}`);
    if (user.rows.length) throw new ProblemError("CONFLICT");
    const count = await tx.execute(sql`SELECT count(*)::int AS count FROM auth.users`);
    if (Number(count.rows[0]?.count) >= 10) throw new ProblemError("CONFLICT");
    const token = randomBytes(32).toString("base64url");
    const inviterName = z
      .string()
      .parse(
        (await tx.execute(sql`SELECT name FROM auth.users WHERE id=${actor.userId}::uuid`)).rows[0]
          ?.name,
      );
    const row = await this.service.options.appDatabase.transaction(actor, async (appTx) => {
      // HTTP and CLI hold the same auth advisory lock before entering this RLS transaction.
      const active = await appTx.execute(
        sql`SELECT id FROM identity.invitations WHERE email=${email} AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      );
      if (active.rows.length) throw new ProblemError("CONFLICT");
      const result =
        await appTx.execute(sql`INSERT INTO identity.invitations(email,role,token_hash,invited_by,expires_at)
        VALUES (${email},${data.role},${createHash("sha256").update(token).digest("hex")},${actor.userId}::uuid,now()+${data.expiresInHours}*interval '1 hour')
        RETURNING id,email,role,invited_by,expires_at,created_at`);
      return invitationRow.parse(result.rows[0]);
    });
    const url = new URL("/rejestracja", this.service.options.configuration.origin);
    url.hash = `t=${token}`;
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
      mail: data.sendEmail
        ? { email, token, expiresAt: row.expires_at.toISOString(), inviterName }
        : undefined,
    };
  }
}
