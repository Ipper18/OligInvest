"use server";
import { loadConfig } from "@oliginvest/config";
import { adminReasonSchema, adminRoleSchema, adminUserPatchSchema } from "@oliginvest/contracts";
import { headers } from "next/headers";
import * as z from "zod";
import { requireAdmin } from "./data";

/**
 * Administrator changes (BL-112, BL-501, BL-509) as one allow-listed Server Action, like
 * `mutateResource` for the portfolio: the browser names an operation, never a path, and Zod stays
 * on the server (budgets.json forbids it in /admin chunks). The API repeats the role check,
 * step-up, audit and every validation; this layer only narrows what can be forwarded.
 */
const id = z.uuid();
const invitationInput = z
  .object({
    email: z.email().max(254),
    role: adminRoleSchema,
    expiresInHours: z.number().int().min(1).max(168),
    sendEmail: z.boolean(),
  })
  .strict();
const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("updateUser"), id, body: adminUserPatchSchema }).strict(),
  z.object({ op: z.literal("deleteUser"), id }).strict(),
  z.object({ op: z.literal("cancelDeletion"), id }).strict(),
  z.object({ op: z.literal("resetTwoFactor"), id, body: adminReasonSchema }).strict(),
  z.object({ op: z.literal("revokeUserSessions"), id }).strict(),
  z.object({ op: z.literal("revokeSession"), id }).strict(),
  z.object({ op: z.literal("revokeInvitation"), id }).strict(),
  z.object({ op: z.literal("createInvitation"), key: id, body: invitationInput }).strict(),
]);
export type AdminOperation = z.input<typeof operation>;
export type AdminOutcome = { status: number; code?: string; data?: unknown };

/** Strict lowercase/uppercase hex UUID with hyphens: no slash, dot, percent, query, host or space. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * The only admin routes this action may call: fixed method and fixed path segments; `id` marks
 * the single place where a validated UUID is inserted. Anything else is rejected before fetch.
 */
const ROUTES = {
  updateUser: { method: "PATCH", segments: ["users", "id"] },
  deleteUser: { method: "DELETE", segments: ["users", "id"] },
  cancelDeletion: { method: "DELETE", segments: ["users", "id", "deletion-request"] },
  resetTwoFactor: { method: "POST", segments: ["users", "id", "reset-2fa"] },
  revokeUserSessions: { method: "POST", segments: ["users", "id", "revoke-sessions"] },
  revokeSession: { method: "DELETE", segments: ["sessions", "id"] },
  revokeInvitation: { method: "DELETE", segments: ["invitations", "id"] },
  createInvitation: { method: "POST", segments: ["invitations"] },
} as const satisfies Record<
  z.output<typeof operation>["op"],
  { method: "PATCH" | "POST" | "DELETE"; segments: readonly string[] }
>;

/** Path below /api/v1/admin, or null when the operation needs an id that is not a strict UUID. */
function adminPath(input: z.output<typeof operation>): string | null {
  const resourceId = "id" in input ? input.id : undefined;
  if (resourceId !== undefined && !UUID.test(resourceId)) return null;
  const parts: string[] = [];
  for (const segment of ROUTES[input.op].segments) {
    if (segment !== "id") parts.push(segment);
    else if (resourceId === undefined) return null;
    else parts.push(encodeURIComponent(resourceId));
  }
  return `/api/v1/admin/${parts.join("/")}`;
}

export async function adminMutation(raw: unknown): Promise<AdminOutcome> {
  await requireAdmin();
  const parsed = operation.safeParse(raw);
  if (!parsed.success) return { status: 422, code: "VALIDATION_FAILED" };
  const input = parsed.data;
  const path = adminPath(input);
  if (path === null) return { status: 422, code: "VALIDATION_FAILED" };
  if (input.op === "createInvitation" && !UUID.test(input.key))
    return { status: 422, code: "VALIDATION_FAILED" };
  const { method } = ROUTES[input.op];
  const body = "body" in input ? input.body : undefined;
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  // Host and protocol only from configuration; the path has fixed segments and a checked UUID.
  const url = new URL(path, new URL(config.API_INTERNAL_URL).origin);
  const incoming = await headers();
  const outgoing = new Headers({
    cookie: incoming.get("cookie") ?? "",
    origin: new URL(config.PUBLIC_BASE_URL).origin,
    "x-request-id": incoming.get("x-request-id") ?? "",
  });
  if (body !== undefined) outgoing.set("Content-Type", "application/json");
  if (input.op === "createInvitation") outgoing.set("Idempotency-Key", input.key);
  try {
    const response = await fetch(url, {
      method,
      headers: outgoing,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const text = response.status === 204 ? "" : await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    const code = z.object({ code: z.string().max(64) }).safeParse(data);
    // Problem bodies go back as a code only; a success body (invitation link) as-is.
    return {
      status: response.status,
      ...(code.success ? { code: code.data.code } : {}),
      ...(response.ok && data !== undefined ? { data } : {}),
    };
  } catch {
    return { status: 503, code: "SERVICE_UNAVAILABLE" };
  }
}
