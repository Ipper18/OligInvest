"use server";
import { loadConfig } from "@oliginvest/config";
import { cookies, headers } from "next/headers";
import QRCode from "qrcode";
import { type ActionName, actionSchemas, problemSchema } from "../api/validation";

export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      code: string;
      requestId: string;
      seconds: string;
      errors: { path: string; message: string }[];
    };
export async function submitAction(name: ActionName, input: unknown): Promise<ActionResult> {
  const failure = (code: string): ActionResult => ({
    ok: false,
    code,
    requestId: "",
    seconds: "60",
    errors: [],
  });
  if (!Object.hasOwn(actionSchemas, name)) return failure("BAD_REQUEST");
  const schema = actionSchemas[name];
  const parsed = schema.input.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      requestId: "",
      seconds: "60",
      errors: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: "required" })),
    };
  const config = loadConfig("web", process.env, {
    mode: process.env.NODE_ENV as "production" | "development" | "test",
  });
  const incoming = await headers();
  try {
    const response = await fetch(new URL(schema.path, new URL(config.API_INTERNAL_URL).origin), {
      method: name === "preferences" ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(config.PUBLIC_BASE_URL).origin,
        cookie: incoming.get("cookie") ?? "",
        "x-request-id": incoming.get("x-request-id") ?? "",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const problem = problemSchema.parse(await response.json());
      return {
        ok: false,
        code: problem.code,
        requestId: response.headers.get("x-request-id") ?? "",
        seconds: response.headers.get("retry-after") ?? "60",
        errors: problem.errors ?? [],
      };
    }
    const data = schema.output.parse(await response.json()) as Record<string, unknown>;
    const jar = await cookies();
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split(";");
      if (!pair) continue;
      const at = pair.indexOf("=");
      const key = pair.slice(0, at);
      if (!key.startsWith("__Host-oliginvest.")) continue;
      const attr = new Map(
        attributes.map((a) => {
          const [k, ...v] = a.trim().split("=");
          return [k!.toLowerCase(), v.join("=")];
        }),
      );
      jar.set(key, decodeURIComponent(pair.slice(at + 1)), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        ...(attr.has("max-age") ? { maxAge: Number(attr.get("max-age")) } : {}),
        ...(attr.has("expires") ? { expires: new Date(attr.get("expires")!) } : {}),
      });
    }
    if (name === "enable")
      data.qr = await QRCode.toDataURL(String(data.totpURI), {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 256,
      });
    return { ok: true, data };
  } catch {
    return failure("SERVICE_UNAVAILABLE");
  }
}
