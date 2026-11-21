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

function target(input: z.output<typeof operation>): {
  method: "PATCH" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  key?: string;
} {
  switch (input.op) {
    case "updateUser":
      return { method: "PATCH", path: `/admin/users/${input.id}`, body: input.body };
    case "deleteUser":
      return { method: "DELETE", path: `/admin/users/${input.id}` };
    case "cancelDeletion":
      return { method: "DELETE", path: `/admin/users/${input.id}/deletion-request` };
    case "resetTwoFactor":
      return { method: "POST", path: `/admin/users/${input.id}/reset-2fa`, body: input.body };
    case "revokeUserSessions":
      return { method: "POST", path: `/admin/users/${input.id}/revoke-sessions` };
    case "revokeSession":
      return { method: "DELETE", path: `/admin/sessions/${input.id}` };
    case "revokeInvitation":
      return { method: "DELETE", path: `/admin/invitations/${input.id}` };
    case "createInvitation":
      return { method: "POST", path: "/admin/invitations", body: input.body, key: input.key };
  }
}

export async function adminMutation(raw: unknown): Promise<AdminOutcome> {
  await requireAdmin();
  const parsed = operation.safeParse(raw);
  if (!parsed.success) return { status: 422, code: "VALIDATION_FAILED" };
  const request = target(parsed.data);
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  const incoming = await headers();
  const outgoing = new Headers({
    cookie: incoming.get("cookie") ?? "",
    origin: new URL(config.PUBLIC_BASE_URL).origin,
    "x-request-id": incoming.get("x-request-id") ?? "",
  });
  if (request.body !== undefined) outgoing.set("Content-Type", "application/json");
  if (request.key) outgoing.set("Idempotency-Key", request.key);
  try {
    const response = await fetch(
      new URL(`/api/v1${request.path}`, new URL(config.API_INTERNAL_URL).origin),
      {
        method: request.method,
        headers: outgoing,
        ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
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
