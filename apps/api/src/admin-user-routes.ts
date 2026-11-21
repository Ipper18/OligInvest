import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  adminInvitationSchema,
  adminPageInfoSchema,
  adminReasonSchema,
  adminRoleSchema,
  adminSessionSchema,
  adminUserPatchSchema,
  adminUserSchema,
} from "@oliginvest/contracts";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { Administration } from "./auth/administration.js";
import type { AuditState } from "./auth/audit.js";
import { deletionRequestSchema } from "./auth/gdpr-routes.js";
import type { IdentityDependencies } from "./auth/identity-routes.js";
import {
  lockAccount,
  maskEmail,
  otherActiveAdmins,
  resetAccountTwoFactor,
  revokeAccountSessions,
} from "./auth/user-administration.js";
import { adminModule, GDPR_LIMITS, marketError } from "./modules.js";
import { conflictError } from "./rate-limited-response.js";

/**
 * Administrator shell API (BL-112, BL-501, BL-509; FR-08.01, FR-08.02). Every route runs inside
 * `Administration.http`: session, MFA, `admin:users`, terms gate and an audit entry for the attempt
 * and the outcome (ADR-006); changes also need a fresh TOTP step-up. Reads touch only `auth.*`
 * (auth role without domain grants) and `identity.invitations` / `identity.admin_deletion_status`
 * (app role, admin context without any portfolio policy), so no financial data can reach a view.
 */

// Hono schemas are created here: contracts may be loaded before the OpenAPI Zod extension.
const open = <T extends z.ZodRawShape>(shape: T, name: string, extra: object = {}) =>
  z
    .object(shape)
    .strict()
    .openapi(name, { additionalProperties: true, ...extra });
const pageInfo = open(adminPageInfoSchema.shape, "PageInfo");
const userSchema = open(adminUserSchema.shape, "AdminUser");
const userPage = open({ data: z.array(userSchema), page: pageInfo }, "AdminUserPage");
const timestamp = z.iso.datetime();
const patchSchema = open(
  {
    ...adminUserPatchSchema.shape,
    banExpires: z
      .union([timestamp, z.null()])
      .openapi({}, { unionPreferredType: "oneOf" })
      .optional(),
  },
  "AdminUserPatch",
  {
    minProperties: 1,
    if: { properties: { banned: { const: true } }, required: ["banned"] },
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable.
    then: { required: ["banReason"] },
  },
);
const reasonSchema = open(adminReasonSchema.shape, "AdminReason");
const invitationSchema = open(adminInvitationSchema.shape, "AdminInvitation");
const invitationPage = open(
  { data: z.array(invitationSchema), page: pageInfo },
  "AdminInvitationPage",
);
const sessionSchema = open(adminSessionSchema.shape, "AdminSession");
const sessionPage = open({ data: z.array(sessionSchema), page: pageInfo }, "AdminSessionPage");

const paging = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
};
const usersQuery = z
  .object({ q: z.string().max(64).optional(), role: adminRoleSchema.optional(), ...paging })
  .strict();
const invitationsQuery = z
  .object({ status: z.enum(["pending", "used", "expired", "revoked"]).optional(), ...paging })
  .strict();
const sessionsQuery = z.object({ userId: z.uuid().optional(), ...paging }).strict();
const userParams = z.object({ userId: z.uuid() }).strict();

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = { 401: marketError, 403: marketError };

/** At most 16 KiB of JSON; anything else is VALIDATION_FAILED (audited by the caller). */
async function readJson(request: Request): Promise<unknown> {
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16_384) {
            await reader.cancel();
            throw new Error("BODY_TOO_LARGE");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProblemError("VALIDATION_FAILED");
  }
}
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ProblemError("VALIDATION_FAILED");
  return result.data;
}

type Work<T> = (
  actor: DatabaseContext & { userId: string },
  appTx: DatabaseTransaction,
  authTx: DatabaseTransaction,
) => Promise<T>;
type Describe<T> = Parameters<Administration["http"]>[4] extends infer D
  ? D extends (result: never) => infer R
    ? (result: T) => R
    : never
  : never;

export function mountAdminUsers(api: OpenAPIHono<AppEnv>, dependencies: IdentityDependencies) {
  if (!adminModule) return;
  const reads = adminModule;
  const register = (route: Parameters<typeof createRoute>[0]) =>
    api.openAPIRegistry.registerPath(
      createRoute({ tags: ["admin"], security: [{ sessionCookie: [] }], ...route }),
    );
  /** Gate, audit and transactions for one admin route; reads skip only the step-up. */
  async function run<T>(
    context: Context<AppEnv>,
    action: string,
    work: Work<T>,
    options: { read?: true; describe?: Describe<T> } = {},
  ): Promise<{ admin: Administration; result: T }> {
    const admin = await dependencies.administration();
    const result = await admin.http(
      context.req.raw,
      action,
      async (actor, appTx, authTx) => {
        if (!actor.userId || actor.role !== "admin") throw new ProblemError("FORBIDDEN");
        if (!(await admin.service.features.enabled("module.admin", actor)))
          throw new ProblemError("NOT_FOUND");
        try {
          return await work({ ...actor, userId: actor.userId }, appTx, authTx);
        } catch (error) {
          if (error instanceof reads.InvalidAdminCursor)
            throw new ProblemError("VALIDATION_FAILED");
          throw error;
        }
      },
      { requestId: context.get("requestContext").requestId, ip: dependencies.clientIp(context) },
      options.describe,
      { database: "app", permission: "admin:users", ...(options.read ? { stepUp: false } : {}) },
    );
    return { admin, result };
  }
  const sessionsChanged = (admin: Administration) =>
    admin.service.options
      .sessionsChanged?.()
      .catch(() => admin.service.options.event("auth.stream_notify_failed"));
  const userState = (row: {
    role: AuditState["role"];
    banned: boolean;
    ban_expires: Date | null;
  }) =>
    ({
      role: row.role,
      banned: row.banned,
      banExpires: row.ban_expires ? row.ban_expires.toISOString() : null,
    }) satisfies AuditState;

  register({
    method: "get",
    path: "/admin/users",
    operationId: "adminListUsers",
    request: { query: usersQuery },
    responses: { 200: json(userPage, "Użytkownicy."), ...errors },
  });
  api.get("/admin/users", async (context) => {
    const { result } = await run(
      context,
      "admin.user.list",
      async (_actor, appTx, authTx) =>
        reads.listUsers(authTx, appTx, parse(usersQuery, context.req.query())),
      { read: true },
    );
    context.header("Cache-Control", "no-store");
    return context.json(userPage.parse(result), 200);
  });

  register({
    method: "get",
    path: "/admin/users/{userId}",
    operationId: "adminGetUser",
    request: { params: userParams },
    responses: { 200: json(userSchema, "Użytkownik."), ...errors, 404: marketError },
  });
  api.get("/admin/users/:userId", async (context) => {
    const { result } = await run(
      context,
      "admin.user.get",
      async (_actor, appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const user = await reads.getUser(authTx, appTx, userId);
        if (!user) throw new ProblemError("NOT_FOUND");
        return user;
      },
      {
        read: true,
        describe: (user) => ({
          resourceType: "user",
          resourceId: user.id,
          before: null,
          after: {},
        }),
      },
    );
    context.header("Cache-Control", "no-store");
    return context.json(userSchema.parse(result), 200);
  });

  register({
    method: "patch",
    path: "/admin/users/{userId}",
    operationId: "adminUpdateUser",
    request: {
      params: userParams,
      body: { required: true, content: { "application/json": { schema: patchSchema } } },
    },
    responses: {
      200: json(userSchema, "Zapisano."),
      ...errors,
      404: marketError,
      409: conflictError,
      422: marketError,
    },
  });
  api.patch("/admin/users/:userId", async (context) => {
    const { admin, result } = await run(
      context,
      "admin.user.update",
      async (actor, appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const input = parse(adminUserPatchSchema, await readJson(context.req.raw));
        if (
          input.banned !== true &&
          (input.banReason !== undefined || input.banExpires !== undefined)
        )
          throw new ProblemError("VALIDATION_FAILED");
        if (input.banExpires && Date.parse(input.banExpires) <= Date.now())
          throw new ProblemError("VALIDATION_FAILED");
        const target = await lockAccount(authTx, userId);
        const self = target.id === actor.userId;
        const email = input.email?.toLowerCase();
        const changes = {
          role: input.role !== undefined && input.role !== target.role,
          email: email !== undefined && email !== target.email.toLowerCase(),
          ban: input.banned === true,
          unban: input.banned === false && target.banned,
        };
        // Own address and own block are out of reach of this path; so is the last active admin.
        if (self && (changes.email || changes.ban)) throw new ProblemError("CONFLICT");
        if (
          changes.role &&
          target.role === "admin" &&
          (await otherActiveAdmins(authTx, target.id)) === 0
        )
          throw new ProblemError("CONFLICT");
        if (
          changes.email &&
          (
            await authTx.execute(
              sql`SELECT 1 FROM auth.users WHERE lower(email)=${email} AND id<>${target.id}::uuid`,
            )
          ).rows.length
        )
          throw new ProblemError("CONFLICT");
        const before = userState(target);
        await authTx.execute(sql`UPDATE auth.users SET
            role = ${changes.role ? (input.role ?? target.role) : target.role},
            email = ${changes.email ? (email ?? target.email) : target.email},
            banned = ${changes.ban ? true : changes.unban ? false : target.banned},
            ban_reason = ${changes.ban ? (input.banReason ?? null) : changes.unban ? null : sql`ban_reason`},
            ban_expires = ${changes.ban ? (input.banExpires ?? null) : changes.unban ? null : sql`ban_expires`}::timestamptz,
            updated_at = now()
          WHERE id = ${target.id}::uuid`);
        // Role, address or block: every session ends (rotation of rights, NFR-03.03).
        const revoked =
          changes.role || changes.email || changes.ban
            ? await revokeAccountSessions(authTx, target.id)
            : 0;
        const user = await reads.getUser(authTx, appTx, target.id);
        if (!user) throw new ProblemError("NOT_FOUND");
        return {
          actor,
          user,
          before,
          changes,
          revoked,
          previousEmail: target.email,
          reason: changes.ban ? input.banReason : undefined,
        };
      },
      {
        // Addresses stay out of the audit trail: erasure pseudonymises ids, not e-mail text.
        describe: (outcome) => ({
          resourceType: "user",
          resourceId: outcome.user.id,
          before: outcome.before,
          after: {
            role: outcome.user.role,
            banned: outcome.user.banned,
            banExpires: outcome.user.banExpires ?? null,
            count: outcome.revoked,
          },
          ...(outcome.reason ? { reason: outcome.reason } : {}),
        }),
      },
    );
    const adminActor = result.actor;
    if (result.changes.role)
      admin.service.monitor((monitor) => monitor.administrativeChanged(adminActor, "role"));
    if (result.changes.email) {
      admin.service.monitor((monitor) => monitor.administrativeChanged(adminActor, "email"));
      const issuedAt = new Date().toISOString();
      for (const message of [
        {
          email: result.previousEmail,
          audience: "previous" as const,
          otherEmailMasked: maskEmail(result.user.email),
        },
        {
          email: result.user.email,
          audience: "current" as const,
          otherEmailMasked: maskEmail(result.previousEmail),
        },
      ]) {
        await admin.effects
          .emailChangedMail({ ...message, userId: result.user.id, issuedAt })
          .catch(() => admin.service.options.event("auth.email_changed_mail_failed"));
      }
    }
    // Regulamin § 4 ust. 4: the account holder is told about a block (and its end) by e-mail.
    if (result.changes.ban || result.changes.unban)
      await admin.effects
        .blockedMail({
          userId: result.user.id,
          email: result.user.email,
          state: result.changes.ban ? "blocked" : "unblocked",
          ...(result.changes.ban && result.user.banExpires
            ? { until: result.user.banExpires }
            : {}),
          issuedAt: new Date().toISOString(),
        })
        .catch(() => admin.service.options.event("auth.account_blocked_mail_failed"));
    if (result.revoked) await sessionsChanged(admin);
    return context.json(userSchema.parse(result.user), 200);
  });

  register({
    method: "delete",
    path: "/admin/users/{userId}",
    operationId: "adminDeleteUser",
    request: { params: userParams },
    responses: {
      202: json(deletionRequestSchema, "Zaplanowano."),
      ...errors,
      404: marketError,
      409: conflictError,
    },
  });
  api.delete("/admin/users/:userId", async (context) => {
    const { admin, result } = await run(
      context,
      "admin.user.delete",
      async (actor, appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const target = await lockAccount(authTx, userId);
        if (target.id === actor.userId) throw new ProblemError("CONFLICT");
        if (target.role === "admin" && (await otherActiveAdmins(authTx, target.id)) === 0)
          throw new ProblemError("CONFLICT");
        // Same request and nightly `identity.erasure` as BL-114; a definer function enforces the
        // admin context, the 14-day minimum and one active request per account.
        const row = (
          await appTx.execute(sql`SELECT id::text, requested_at, scheduled_for
            FROM identity.admin_schedule_deletion(${target.id}::uuid, ${GDPR_LIMITS.deletionGraceDays})`)
        ).rows[0];
        if (!row) throw new ProblemError("CONFLICT", { retryAfterSeconds: 86400 });
        return {
          target,
          request: deletionRequestSchema.parse({
            id: row.id,
            requestedAt: new Date(row.requested_at as string).toISOString(),
            scheduledFor: new Date(row.scheduled_for as string).toISOString(),
            requestedBy: "admin",
          }),
        };
      },
      {
        describe: (outcome) => ({
          resourceType: "user",
          resourceId: outcome.target.id,
          before: null,
          after: { scheduledFor: outcome.request.scheduledFor, requestedBy: "admin" },
        }),
      },
    );
    await admin.service.options.securityMonitor
      ?.deletionRequestedByAdmin(
        { userId: result.target.id, role: result.target.role },
        { requestId: result.request.id, scheduledFor: result.request.scheduledFor },
      )
      .catch(() => admin.service.options.event("gdpr.deletion_mail_failed"));
    return context.json(deletionRequestSchema.parse(result.request), 202);
  });

  register({
    method: "delete",
    path: "/admin/users/{userId}/deletion-request",
    operationId: "adminCancelUserDeletion",
    request: { params: userParams },
    responses: { 204: { description: "Anulowano." }, ...errors, 404: marketError },
  });
  api.delete("/admin/users/:userId/deletion-request", async (context) => {
    const { admin, result } = await run(
      context,
      "admin.user.deletion_cancel",
      async (_actor, appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const target = await lockAccount(authTx, userId);
        const id = (
          await appTx.execute(
            sql`SELECT identity.admin_cancel_deletion(${target.id}::uuid)::text AS id`,
          )
        ).rows[0]?.id;
        if (typeof id !== "string") throw new ProblemError("NOT_FOUND");
        return { target, requestId: id };
      },
      {
        describe: (outcome) => ({
          resourceType: "user",
          resourceId: outcome.target.id,
          before: { requestedBy: "admin" },
          after: {},
        }),
      },
    );
    await admin.service.options.securityMonitor
      ?.deletionCancelled(
        { userId: result.target.id, role: result.target.role },
        { requestId: result.requestId },
      )
      .catch(() => admin.service.options.event("gdpr.deletion_mail_failed"));
    return context.body(null, 204);
  });

  register({
    method: "post",
    path: "/admin/users/{userId}/reset-2fa",
    operationId: "adminResetTwoFactor",
    request: {
      params: userParams,
      body: { required: true, content: { "application/json": { schema: reasonSchema } } },
    },
    responses: {
      204: { description: "Zresetowano." },
      ...errors,
      404: marketError,
      409: conflictError,
      422: marketError,
    },
  });
  api.post("/admin/users/:userId/reset-2fa", async (context) => {
    const { admin, result } = await run(
      context,
      "admin.user.reset_2fa",
      async (actor, _appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const { reason } = parse(adminReasonSchema, await readJson(context.req.raw));
        const target = await lockAccount(authTx, userId);
        // Resetting one's own factor here would skip the recovery flow (backup codes).
        if (target.id === actor.userId) throw new ProblemError("CONFLICT");
        const { before } = await resetAccountTwoFactor(authTx, target.id);
        return { actor, target, before, reason };
      },
      {
        describe: (outcome) => ({
          resourceType: "user",
          resourceId: outcome.target.id,
          before: { twoFactorEnabled: outcome.before },
          after: { twoFactorEnabled: false },
          reason: outcome.reason,
        }),
      },
    );
    admin.service.monitor((monitor) => monitor.administrativeChanged(result.actor, "reset-2fa"));
    await admin.effects
      .resetMail({ email: result.target.email, issuedAt: new Date().toISOString() })
      .catch(() => admin.service.options.event("auth.reset_mail_failed"));
    await sessionsChanged(admin);
    return context.body(null, 204);
  });

  register({
    method: "post",
    path: "/admin/users/{userId}/revoke-sessions",
    operationId: "adminRevokeUserSessions",
    request: { params: userParams },
    responses: {
      204: { description: "Unieważniono (skutek ≤ 60 s)." },
      ...errors,
      404: marketError,
    },
  });
  api.post("/admin/users/:userId/revoke-sessions", async (context) => {
    const { admin } = await run(
      context,
      "admin.user.revoke_sessions",
      async (_actor, _appTx, authTx) => {
        const { userId } = parse(userParams, { userId: context.req.param("userId") });
        const target = await lockAccount(authTx, userId);
        return { target, count: await revokeAccountSessions(authTx, target.id) };
      },
      {
        describe: (outcome) => ({
          resourceType: "user",
          resourceId: outcome.target.id,
          before: null,
          after: { count: outcome.count },
        }),
      },
    );
    await sessionsChanged(admin);
    return context.body(null, 204);
  });

  register({
    method: "get",
    path: "/admin/invitations",
    operationId: "adminListInvitations",
    request: { query: invitationsQuery },
    responses: { 200: json(invitationPage, "Zaproszenia."), ...errors },
  });
  api.get("/admin/invitations", async (context) => {
    const { result } = await run(
      context,
      "admin.invitation.list",
      async (_actor, appTx) =>
        reads.listInvitations(appTx, parse(invitationsQuery, context.req.query())),
      { read: true },
    );
    context.header("Cache-Control", "no-store");
    return context.json(invitationPage.parse(result), 200);
  });

  const invitationParams = z.object({ invitationId: z.uuid() }).strict();
  register({
    method: "delete",
    path: "/admin/invitations/{invitationId}",
    operationId: "adminRevokeInvitation",
    request: { params: invitationParams },
    responses: {
      204: { description: "Odwołano." },
      ...errors,
      404: marketError,
      409: conflictError,
    },
  });
  api.delete("/admin/invitations/:invitationId", async (context) => {
    await run(
      context,
      "admin.invitation.revoke",
      async (_actor, appTx) => {
        const { invitationId } = parse(invitationParams, {
          invitationId: context.req.param("invitationId"),
        });
        const row = (
          await appTx.execute(sql`UPDATE identity.invitations SET revoked_at = now()
            WHERE id = ${invitationId}::uuid AND used_at IS NULL AND revoked_at IS NULL
            RETURNING id::text`)
        ).rows[0];
        if (row) return { id: invitationId };
        const exists = (
          await appTx.execute(
            sql`SELECT 1 FROM identity.invitations WHERE id = ${invitationId}::uuid`,
          )
        ).rows.length;
        throw new ProblemError(exists ? "CONFLICT" : "NOT_FOUND");
      },
      {
        describe: (outcome) => ({
          resourceType: "invitation",
          resourceId: outcome.id,
          before: { status: "pending" },
          after: {},
        }),
      },
    );
    return context.body(null, 204);
  });

  register({
    method: "get",
    path: "/admin/sessions",
    operationId: "adminListSessions",
    request: { query: sessionsQuery },
    responses: { 200: json(sessionPage, "Sesje."), ...errors },
  });
  api.get("/admin/sessions", async (context) => {
    const { result } = await run(
      context,
      "admin.session.list",
      async (_actor, _appTx, authTx) =>
        reads.listSessions(authTx, parse(sessionsQuery, context.req.query())),
      { read: true },
    );
    context.header("Cache-Control", "no-store");
    return context.json(sessionPage.parse(result), 200);
  });

  const sessionParams = z.object({ sessionId: z.uuid() }).strict();
  register({
    method: "delete",
    path: "/admin/sessions/{sessionId}",
    operationId: "adminRevokeSession",
    request: { params: sessionParams },
    responses: {
      204: { description: "Unieważniono (skutek ≤ 60 s)." },
      ...errors,
      404: marketError,
    },
  });
  api.delete("/admin/sessions/:sessionId", async (context) => {
    const { admin } = await run(
      context,
      "admin.session.revoke",
      async (_actor, _appTx, authTx) => {
        const { sessionId } = parse(sessionParams, { sessionId: context.req.param("sessionId") });
        const row = (
          await authTx.execute(
            sql`DELETE FROM auth.sessions WHERE id = ${sessionId}::uuid RETURNING user_id::text`,
          )
        ).rows[0];
        if (!row) throw new ProblemError("NOT_FOUND");
        return { sessionId, userId: String(row.user_id) };
      },
      {
        describe: (outcome) => ({
          resourceType: "session",
          resourceId: outcome.sessionId,
          before: null,
          after: { users: [outcome.userId] },
        }),
      },
    );
    await sessionsChanged(admin);
    return context.body(null, 204);
  });
}
