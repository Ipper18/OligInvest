import { randomBytes, randomUUID } from "node:crypto";
import { loadConfig } from "@oliginvest/config";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { meSchema } from "./api/validation";
import { gatePath, safeReturnTo } from "./auth/navigation";
import { uiModules } from "./modules";

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const candidate = z.uuid().safeParse(request.headers.get("x-request-id"));
  const requestId = candidate.success ? candidate.data : randomUUID();
  const development = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", requestId);
  headers.set("content-security-policy", csp);
  headers.set("x-oi-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers } });
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/" ||
    /^\/(portfel|rynek|analizy|alerty|nauka|ustawienia|admin)(\/|$)/u.test(pathname)
  ) {
    let me = null;
    if (request.cookies.has("__Host-oliginvest.session_token")) {
      try {
        const config = loadConfig("web", process.env, {
          mode: development ? "development" : "production",
        });
        const url = new URL(config.API_INTERNAL_URL);
        url.pathname = "/api/v1/me";
        const result = await fetch(url, {
          headers: { cookie: request.headers.get("cookie") ?? "", "x-request-id": requestId },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        if (result.ok) me = meSchema.parse(await result.json());
        else if (result.status !== 401 && result.status !== 403)
          throw new Error("SESSION_UNAVAILABLE");
      } catch {
        response = new NextResponse(null, { status: 503 });
      }
    }
    if (response.status !== 503) {
      const gate = gatePath(me);
      if (gate) {
        const destination = new URL(gate, request.url);
        destination.searchParams.set("returnTo", safeReturnTo(pathname + request.nextUrl.search));
        response = NextResponse.redirect(destination);
      } else if (me) {
        const module = uiModules.find((entry) =>
          entry.nav?.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
        );
        if (
          (pathname.startsWith("/admin") && me.role !== "admin") ||
          (module &&
            (me.features[`module.${module.id}`] === false ||
              !module.nav?.some((item) => me.permissions.includes(item.permission))))
        )
          response = NextResponse.rewrite(new URL("/missing-module", request.url), {
            status: 404,
            request: { headers },
          });
      }
    }
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
