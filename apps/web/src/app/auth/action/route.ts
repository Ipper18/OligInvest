import type { NextRequest } from "next/server";
import type { ActionName } from "../../../api/validation";
import type { ActionResult } from "../../../auth/actions";
import { relayAction } from "../../../auth/relay";

const MAX_BODY_BYTES = 65536;
const headers = { "Cache-Control": "no-store" };
const refuse = (status: number, code: string) =>
  Response.json(
    { ok: false, code, requestId: "", seconds: "60", errors: [] } satisfies ActionResult,
    { status, headers },
  );

// Same-origin guard equivalent to the Server Action check: the browser Origin must match the
// host this request was addressed to, and only a JSON body (never a simple form post) is read.
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const site = request.headers.get("sec-fetch-site");
  if (!origin || !host || (site !== null && site !== "same-origin")) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return refuse(403, "FORBIDDEN");
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return refuse(415, "BAD_REQUEST");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return refuse(413, "BAD_REQUEST");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return refuse(413, "BAD_REQUEST");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "BAD_REQUEST");
  }
  const { name, input } = (body ?? {}) as { name?: unknown; input?: unknown };
  if (typeof name !== "string") return refuse(400, "BAD_REQUEST");
  // relayAction rejects names outside actionSchemas and validates the input.
  return Response.json(await relayAction(name as ActionName, input), { headers });
}
