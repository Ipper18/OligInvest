import "server-only";
import {
  adminInvitationPageSchema,
  adminSessionPageSchema,
  adminUserPageSchema,
  adminUserSchema,
} from "@oliginvest/contracts";
import { adminCopy } from "@oliginvest/i18n/admin";
import { getLocalization } from "@oliginvest/ui/localization-server";
import { notFound } from "next/navigation";
import * as z from "zod";
import { getApiClient } from "../api/server";
import { requireMe } from "../auth/session";
import { uiModules } from "../ui-registry";

/**
 * /admin data (BL-112, BL-501, BL-509): server-only reads through the API, which checks the role,
 * MFA and audit again. A build without the admin module has no `admin` UI entry → 404 here.
 */
export async function requireAdmin() {
  const me = await requireMe();
  if (
    !uiModules.some((module) => module.id === "admin") ||
    me.role !== "admin" ||
    me.features["module.admin"] === false ||
    !me.permissions.includes("admin:users")
  )
    notFound();
  const localization = await getLocalization();
  return { me, m: adminCopy(localization.locale), localization };
}

const cursor = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .optional();
type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function usersQuery(search: Search) {
  const q = z.string().max(64).safeParse(one(search.q));
  const role = z.enum(["user", "pro", "admin"]).safeParse(one(search.role));
  const next = cursor.safeParse(one(search.cursor));
  return {
    limit: 50,
    ...(q.success && q.data.trim() ? { q: q.data.trim() } : {}),
    ...(role.success ? { role: role.data } : {}),
    ...(next.success && next.data ? { cursor: next.data } : {}),
  };
}
export function invitationsQuery(search: Search) {
  const status = z.enum(["pending", "used", "expired", "revoked"]).safeParse(one(search.status));
  const next = cursor.safeParse(one(search.cursor));
  return {
    limit: 50,
    ...(status.success ? { status: status.data } : {}),
    ...(next.success && next.data ? { cursor: next.data } : {}),
  };
}
export function sessionsQuery(search: Search) {
  const next = cursor.safeParse(one(search.cursor));
  return { limit: 50, ...(next.success && next.data ? { cursor: next.data } : {}) };
}

function checked(response: Response) {
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("ADMIN_UNAVAILABLE");
}
export async function readUsers(query: ReturnType<typeof usersQuery>) {
  await requireAdmin();
  const result = await (await getApiClient()).GET("/admin/users", { params: { query } });
  checked(result.response);
  return adminUserPageSchema.parse(result.data);
}
export async function readUser(userId: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(userId).success) notFound();
  const api = await getApiClient();
  const result = await api.GET("/admin/users/{userId}", { params: { path: { userId } } });
  checked(result.response);
  const sessions = await api.GET("/admin/sessions", { params: { query: { userId, limit: 50 } } });
  checked(sessions.response);
  return {
    user: adminUserSchema.parse(result.data),
    sessions: adminSessionPageSchema.parse(sessions.data),
  };
}
export async function readInvitations(query: ReturnType<typeof invitationsQuery>) {
  await requireAdmin();
  const result = await (await getApiClient()).GET("/admin/invitations", { params: { query } });
  checked(result.response);
  return adminInvitationPageSchema.parse(result.data);
}
export async function readSessions(query: ReturnType<typeof sessionsQuery>) {
  await requireAdmin();
  const result = await (await getApiClient()).GET("/admin/sessions", { params: { query } });
  checked(result.response);
  return adminSessionPageSchema.parse(result.data);
}
