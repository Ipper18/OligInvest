import {
  type AdminInvitation,
  type AdminSession,
  type AdminUser,
  adminInvitationSchema,
  adminSessionSchema,
  adminUserSchema,
} from "@oliginvest/contracts";
import type { DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";

/**
 * Read models of the administrator shell (BL-112, BL-501; FR-08.01, FR-08.02). Every query below
 * reads only account, session, invitation and deletion-status data: `auth.users`, `auth.sessions`
 * (auth role, which has no grant on any domain schema) and `identity.invitations` plus
 * `identity.admin_deletion_status()` (app role, admin context, which has no RLS policy on
 * portfolio tables). `test/no-financial-data.test.mjs` keeps it that way.
 */
export const ADMIN_READ_TABLES = [
  "auth.users",
  "auth.sessions",
  "identity.invitations",
  "identity.admin_deletion_status",
] as const;

/** A malformed cursor; the host maps it to VALIDATION_FAILED. */
export class InvalidAdminCursor extends Error {
  constructor() {
    super("ADMIN_CURSOR_INVALID");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
type Row = Record<string, unknown>;
type Page<T> = { data: T[]; page: { hasMore: boolean; nextCursor?: string } };

const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const optionalIso = (value: unknown) =>
  value === null || value === undefined ? undefined : iso(value);
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** Opaque keyset cursor: base64url of `[createdAt, id]`. */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}
export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined) return null;
  try {
    if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string" ||
      Number.isNaN(Date.parse(value[0])) ||
      !UUID.test(value[1])
    )
      throw new Error();
    // Full database precision (microseconds): a millisecond ISO string would repeat a row.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/u.test(value[0]))
      throw new Error();
    return { at: value[0], id: value[1] };
  } catch {
    throw new InvalidAdminCursor();
  }
}
/** Rows carry `cursor_at` (exact `created_at` text) and `id` for the keyset. */
function page<T>(rows: Row[], limit: number, map: (row: Row) => T): Page<T> {
  const data = rows.slice(0, limit).map(map);
  const last = rows[limit - 1];
  return rows.length > limit && last
    ? {
        data,
        page: { hasMore: true, nextCursor: encodeCursor(String(last.cursor_at), String(last.id)) },
      }
    : { data, page: { hasMore: false } };
}
const cursorAt = (column: ReturnType<typeof sql.raw>) =>
  sql`to_json(${column})#>>'{}' AS cursor_at`;

export type DeletionStatus = { scheduledFor: string; requestedBy: "user" | "admin" };

/** App-role transaction in the administrator's context. */
export async function deletionStatus(
  appTx: DatabaseTransaction,
  userIds: readonly string[],
): Promise<Map<string, DeletionStatus>> {
  const ids = userIds.filter((id) => UUID.test(id));
  if (!ids.length) return new Map();
  const rows = (
    await appTx.execute(
      sql`SELECT user_id::text, scheduled_for, requested_by FROM identity.admin_deletion_status(${`{${ids.join(",")}}`}::uuid[])`,
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      String(row.user_id),
      {
        scheduledFor: iso(row.scheduled_for),
        requestedBy: row.requested_by === "admin" ? "admin" : "user",
      },
    ]),
  );
}

const userColumns = sql`${cursorAt(sql.raw("u.created_at"))}, u.id::text, u.email, u.name, u.role, u.banned, u.ban_reason, u.ban_expires,
  u.two_factor_enabled, u.email_verified, u.created_at,
  (SELECT max(s.updated_at) FROM auth.sessions s WHERE s.user_id = u.id) AS last_active_at,
  (SELECT count(*)::int FROM auth.sessions s WHERE s.user_id = u.id AND s.expires_at > now()
     AND s.created_at > now() - interval '30 days') AS active_sessions`;

export function toAdminUser(row: Row, deletion?: DeletionStatus): AdminUser {
  const banned = row.banned === true;
  return adminUserSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    banned,
    ...(banned && text(row.ban_reason) ? { banReason: text(row.ban_reason) } : {}),
    ...(banned && row.ban_expires ? { banExpires: iso(row.ban_expires) } : {}),
    twoFactorEnabled: row.two_factor_enabled === true,
    emailVerified: row.email_verified === true,
    createdAt: iso(row.created_at),
    ...(row.last_active_at ? { lastActiveAt: iso(row.last_active_at) } : {}),
    activeSessions: Number(row.active_sessions ?? 0),
    ...(deletion
      ? { deletionScheduledFor: deletion.scheduledFor, deletionRequestedBy: deletion.requestedBy }
      : {}),
  });
}

export async function listUsers(
  authTx: DatabaseTransaction,
  appTx: DatabaseTransaction,
  query: {
    q?: string | undefined;
    role?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  },
): Promise<Page<AdminUser>> {
  const after = decodeCursor(query.cursor);
  const q = query.q?.trim().toLowerCase() || null;
  const rows = (
    await authTx.execute(sql`SELECT ${userColumns} FROM auth.users u
      WHERE (${q}::text IS NULL OR strpos(lower(u.email), ${q}::text) > 0 OR strpos(lower(u.name), ${q}::text) > 0)
        AND (${query.role ?? null}::text IS NULL OR u.role = ${query.role ?? null}::text)
        AND (${after?.at ?? null}::timestamptz IS NULL
             OR (u.created_at, u.id) > (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
      ORDER BY u.created_at, u.id LIMIT ${query.limit + 1}`)
  ).rows;
  const deletions = await deletionStatus(
    appTx,
    rows.map((row) => String(row.id)),
  );
  return page(rows, query.limit, (row) => toAdminUser(row, deletions.get(String(row.id))));
}

export async function getUser(
  authTx: DatabaseTransaction,
  appTx: DatabaseTransaction,
  userId: string,
): Promise<AdminUser | null> {
  if (!UUID.test(userId)) return null;
  const row = (
    await authTx.execute(sql`SELECT ${userColumns} FROM auth.users u WHERE u.id = ${userId}::uuid`)
  ).rows[0];
  if (!row) return null;
  return toAdminUser(row, (await deletionStatus(appTx, [userId])).get(userId));
}

export async function listSessions(
  authTx: DatabaseTransaction,
  query: { userId?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<Page<AdminSession>> {
  const before = decodeCursor(query.cursor);
  const rows = (
    await authTx.execute(sql`SELECT ${cursorAt(sql.raw("s.created_at"))}, s.id::text, s.user_id::text, u.email AS user_email, s.created_at,
        s.expires_at, s.ip_address, s.user_agent, s.mfa_verified_at
      FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
      WHERE s.expires_at > now() AND s.created_at > now() - interval '30 days'
        AND (${query.userId ?? null}::uuid IS NULL OR s.user_id = ${query.userId ?? null}::uuid)
        AND (${before?.at ?? null}::timestamptz IS NULL
             OR (s.created_at, s.id) < (${before?.at ?? null}::timestamptz, ${before?.id ?? null}::uuid))
      ORDER BY s.created_at DESC, s.id DESC LIMIT ${query.limit + 1}`)
  ).rows;
  return page(rows, query.limit, (row) =>
    adminSessionSchema.parse({
      id: row.id,
      userId: row.user_id,
      userEmail: row.user_email,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      ...(text(row.ip_address) ? { ipAddress: text(row.ip_address) } : {}),
      ...(text(row.user_agent) ? { userAgent: text(row.user_agent)?.slice(0, 512) } : {}),
      ...(optionalIso(row.mfa_verified_at)
        ? { mfaVerifiedAt: optionalIso(row.mfa_verified_at) }
        : {}),
    }),
  );
}

const invitationStatus = sql`CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked'
  WHEN i.used_at IS NOT NULL THEN 'used' WHEN i.expires_at <= now() THEN 'expired' ELSE 'pending' END`;

export async function listInvitations(
  appTx: DatabaseTransaction,
  query: { status?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<Page<AdminInvitation>> {
  const before = decodeCursor(query.cursor);
  const rows = (
    await appTx.execute(sql`SELECT ${cursorAt(sql.raw("i.created_at"))}, i.id::text, i.email, i.role, i.invited_by::text, i.expires_at,
        i.used_at, i.revoked_at, i.created_at, ${invitationStatus} AS status
      FROM identity.invitations i
      WHERE (${query.status ?? null}::text IS NULL OR ${invitationStatus} = ${query.status ?? null}::text)
        AND (${before?.at ?? null}::timestamptz IS NULL
             OR (i.created_at, i.id) < (${before?.at ?? null}::timestamptz, ${before?.id ?? null}::uuid))
      ORDER BY i.created_at DESC, i.id DESC LIMIT ${query.limit + 1}`)
  ).rows;
  return page(rows, query.limit, (row) =>
    adminInvitationSchema.parse({
      id: row.id,
      email: row.email,
      role: row.role,
      ...(text(row.invited_by) ? { invitedBy: row.invited_by } : {}),
      status: row.status,
      expiresAt: iso(row.expires_at),
      ...(row.used_at ? { usedAt: iso(row.used_at) } : {}),
      ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
      createdAt: iso(row.created_at),
    }),
  );
}
