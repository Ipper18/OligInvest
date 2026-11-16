import "server-only";
import { loadConfig } from "@oliginvest/config";
import { cookies, headers } from "next/headers";
import QRCode from "qrcode";
import { type ActionName, actionSchemas, problemSchema } from "../api/validation";
import { LOCALE_COOKIE, localeCookieOptions } from "../appearance/locale-cookie";
import type { ActionResult } from "./actions";

const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

// A deletion must be unambiguous in every browser: `Max-Age=0` makes the expiry equal to "now"
// (second granularity), and Firefox can then keep an empty, not-yet-purged cookie for that second.
// `delete` sends only `Expires=Thu, 01 Jan 1970 00:00:00 GMT` (no Max-Age, which would override it).
function expireCookie(jar: Awaited<ReturnType<typeof cookies>>, name: string) {
  jar.delete({ name, ...SESSION_COOKIE_ATTRIBUTES });
}

// Runs inside the /auth/action route handler, not a Server Action: cookie writes here must not
// re-render the current route, because the caller follows success with a document navigation.
export async function relayAction(name: ActionName, input: unknown): Promise<ActionResult> {
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
      const maxAgeAttribute = attr.get("max-age");
      const expiresAttribute = attr.get("expires");
      const maxAge = maxAgeAttribute === undefined ? undefined : Number(maxAgeAttribute);
      const expires = expiresAttribute === undefined ? undefined : new Date(expiresAttribute);
      // Max-Age wins over Expires (RFC 6265 § 5.3), so only a missing Max-Age defers to Expires.
      if (
        maxAge !== undefined
          ? maxAge <= 0
          : (expires?.getTime() ?? Number.POSITIVE_INFINITY) <= Date.now()
      ) {
        expireCookie(jar, key);
        continue;
      }
      jar.set(key, decodeURIComponent(pair.slice(at + 1)), {
        ...SESSION_COOKIE_ATTRIBUTES,
        ...(maxAge !== undefined ? { maxAge } : {}),
        ...(expires ? { expires } : {}),
      });
    }
    if (name === "preferences" && (data.locale === "pl-PL" || data.locale === "en-US"))
      jar.set(
        LOCALE_COOKIE,
        data.locale,
        localeCookieOptions(process.env.NODE_ENV === "development"),
      );
    if (name === "enable")
      data.qr = await QRCode.toDataURL(String(data.totpURI), {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 256,
      });
    return { ok: true, data };
  } catch {
    return failure("SERVICE_UNAVAILABLE");
  } finally {
    if (name === "signOut") {
      const jar = await cookies();
      for (const cookie of jar.getAll()) {
        if (cookie.name.startsWith("__Host-oliginvest.")) expireCookie(jar, cookie.name);
      }
    }
  }
}
