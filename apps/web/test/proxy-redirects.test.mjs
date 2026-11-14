// BL-613: proxy redirects carry a declared body type (ZAP 10019) and a signed-in visitor leaves
// /logowanie in the proxy with a minimal 307 (ZAP 10044), keeping the returnTo validation.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { proxy } from "../src/proxy.ts";

const SESSION = "__Host-oliginvest.session_token=fixture";
const context = { me: null, status: 200, calls: 0 };

function me(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "ui@example.test",
    name: "UI",
    role: "user",
    mfa: { enrolled: true, sessionVerifiedAt: "2026-11-10T12:00:00Z" },
    legal: { termsAcceptanceRequired: false, diagnosticsConsent: false },
    permissions: [],
    features: {},
    preferences: {
      baseCurrency: "PLN",
      costBasisMethod: "fifo",
      plView: "economic",
      taxDateBasis: "settlement",
      taxIncludeFxFee: true,
      timezone: "Europe/Warsaw",
      locale: "pl-PL",
      theme: "system",
      plPalette: "default",
    },
    ...overrides,
  };
}

function request(path, cookie = SESSION) {
  return new NextRequest(`https://example.test${path}`, {
    headers: cookie ? { cookie: `${cookie}; oi-locale=pl-PL` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_BASE_URL", "https://example.test/");
  vi.stubEnv("API_INTERNAL_URL", "http://api.example.test:4000");
  Object.assign(context, { me: me(), status: 200, calls: 0 });
  vi.stubGlobal("fetch", async (url) => {
    context.calls += 1;
    expect(new URL(url).pathname).toBe("/api/v1/me");
    if (context.status !== 200) return new Response(null, { status: context.status });
    return Response.json(context.me);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectMinimalRedirect(response, location) {
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`https://example.test${location}`);
  // Next's router writes the relative Location as the body; the proxy adds no body of its own.
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(response.body).toBeNull();
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
}

test("gate redirects declare their plain-text body and keep the security headers", async () => {
  const anonymous = await proxy(request("/", null));
  expectMinimalRedirect(anonymous, "/logowanie?returnTo=%2F");
  expect(context.calls).toBe(0);
  context.me = me({ mfa: { enrolled: true } });
  expectMinimalRedirect(
    await proxy(request("/portfel/operacje?accountId=a")),
    "/logowanie/2fa?returnTo=%2Fportfel%2Foperacje%3FaccountId%3Da",
  );
});

test("a signed-in visitor on /logowanie is redirected by the proxy to the validated returnTo", async () => {
  expectMinimalRedirect(await proxy(request("/logowanie")), "/");
  expectMinimalRedirect(
    await proxy(request("/logowanie?returnTo=%2Fustawienia%3Ftab%3Dsecurity")),
    "/ustawienia?tab=security",
  );
  expect(context.calls).toBe(2);
});

test("pending gates from /logowanie carry the destination like the page did", async () => {
  for (const [state, location] of [
    [
      me({ legal: { termsAcceptanceRequired: true, diagnosticsConsent: false } }),
      "/akceptacja-regulaminu",
    ],
    [me({ mfa: { enrolled: true } }), "/logowanie/2fa"],
    [me({ mfa: { enrolled: false } }), "/konfiguracja-2fa"],
  ]) {
    context.me = state;
    expectMinimalRedirect(
      await proxy(request("/logowanie?returnTo=%2Fustawienia")),
      `${location}?returnTo=%2Fustawienia`,
    );
  }
});

test("/logowanie applies the unchanged returnTo validation", async () => {
  for (const returnTo of [
    ["/ustawienia", "//bad.test"],
    ["https://bad.test"],
    ["//bad.test"],
    ["/\\bad.test"],
    ["/\nbad.test"],
    ["/logowanie/2fa"],
    ["/api/auth/sign-out"],
    ["/%2e%2e/admin"],
  ]) {
    const query = new URLSearchParams(returnTo.map((value) => ["returnTo", value]));
    expectMinimalRedirect(await proxy(request(`/logowanie?${query}`)), "/");
  }
});

test("/logowanie renders the form without a session or when the session is unusable", async () => {
  for (const [cookie, status, calls] of [
    [null, 200, 0],
    [SESSION, 401, 1],
    [SESSION, 500, 1],
  ]) {
    Object.assign(context, { status, calls: 0 });
    const response = await proxy(request("/logowanie?returnTo=%2Fustawienia", cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(context.calls).toBe(calls);
  }
  // Private routes keep failing closed when the session cannot be checked.
  context.status = 500;
  expect((await proxy(request("/ustawienia"))).status).toBe(503);
});

test("the proxy syncs the language cookie only as HttpOnly (ZAP 10010)", async () => {
  context.me = me({ preferences: { ...me().preferences, locale: "en-US" } });
  const response = await proxy(request("/ustawienia"));
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("oi-locale="));
  expect(cookie).toMatch(/^oi-locale=en-US;/u);
  expect(cookie).toMatch(/; HttpOnly/iu);
  expect(cookie).toMatch(/; Secure/iu);
  expect(cookie).toMatch(/; SameSite=lax/iu);
  expect(cookie).toMatch(/; Path=\//iu);
});
