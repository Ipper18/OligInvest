// Synthetic UI boundary only. Real authentication/RLS is tested by apps/api/integration.
import { randomUUID } from "node:crypto";
import { portfolioFixture } from "./portfolio-fixture.mjs";

const preferences = {
  baseCurrency: "PLN",
  costBasisMethod: "fifo",
  plView: "economic",
  taxDateBasis: "settlement",
  taxIncludeFxFee: true,
  timezone: "Europe/Warsaw",
  locale: "pl-PL",
  theme: "dark",
  plPalette: "default",
};
const saved = new Map();
const user = {
  id: "01900000-0000-7000-8000-000000000001",
  email: "ui@example.test",
  name: "UI fixture",
  role: "user",
  emailVerified: true,
  twoFactorEnabled: true,
};
const session = {
  id: "01900000-0000-7000-8000-000000000002",
  expiresAt: "2027-01-01T00:00:00Z",
  mfaVerifiedAt: "2026-10-12T00:00:00Z",
};
const codes = Array.from({ length: 10 }, (_, i) => `fixture-000${i}`);
const token = (request) =>
  /\b__Host-oliginvest\.session_token=(fixture-[\w-]+)/u.exec(request.headers.cookie ?? "")?.[1];
export function fixtureCookie(route) {
  if (process.env.BASE_URL)
    return (
      JSON.parse(process.env.PERF_ROUTE_COOKIES ?? "{}")[route] ??
      process.env.LH_SESSION_COOKIE ??
      ""
    );
  if (route === "/konfiguracja-2fa") return "__Host-oliginvest.session_token=fixture-enroll";
  if (route === "/akceptacja-regulaminu") return "__Host-oliginvest.session_token=fixture-legal";
  if (route === "/logowanie/2fa") return "__Host-oliginvest.two_factor=fixture-challenge";
  if (
    route === "/" ||
    route.startsWith("/ustawienia") ||
    route.startsWith("/portfel") ||
    route.startsWith("/rynek") ||
    route.startsWith("/nauka")
  )
    return "__Host-oliginvest.session_token=fixture-perf";
  return "";
}
function legal(required) {
  return {
    terms: { currentVersion: "2026-09", url: "/regulamin" },
    privacyNotice: { currentVersion: "2026-09", url: "/prywatnosc" },
    consents: { diagnostics: { granted: false } },
    termsAcceptanceRequired: required,
  };
}
export async function uiFixture(request, response) {
  const path = request.url;
  if (!path?.startsWith("/api/")) return false;
  response.setHeader("Content-Type", "application/json");
  const send = (value, status = 200) => {
    response.writeHead(status).end(JSON.stringify(value));
    return true;
  };
  const fail = (code = "UNAUTHENTICATED", status = 401) =>
    send({ type: "https://example.test/problems/auth", title: code, status, code }, status);
  const key = token(request),
    profile = key
      ? (saved.get(key) ?? {
          ...preferences,
          theme: key.includes("light") ? "light" : "dark",
          required: key.startsWith("fixture-legal"),
          enrolled: !key.startsWith("fixture-enroll"),
          verified: !key.startsWith("fixture-unverified"),
        })
      : null;
  if (path === "/api/v1/health/live") return send({ status: "ok" });
  if (path === "/api/v1/me")
    return profile
      ? send({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: true,
          mfa: {
            enrolled: profile.enrolled,
            ...(profile.verified ? { sessionVerifiedAt: session.mfaVerifiedAt } : {}),
          },
          legal: { termsAcceptanceRequired: profile.required, diagnosticsConsent: false },
          permissions: [
            "portfolio:read",
            "market:read",
            "alerts:manage",
            "analytics:run:light",
            "education:use",
          ],
          features: {
            "module.portfolio.import.mbank": !key.includes("no-mbank"),
            "module.alerts": !key.includes("no-alerts"),
            "module.analytics": true,
            "module.education": true,
          },
          preferences: Object.fromEntries(Object.keys(preferences).map((k) => [k, profile[k]])),
        })
      : fail();
  if (path === "/api/v1/me/legal" && request.method === "GET")
    return profile ? send(legal(profile.required)) : fail();
  if (
    /^\/api\/v1\/stream\/connections\/[\w-]+\/instruments$/.test(path) &&
    request.method === "PUT"
  ) {
    if (!profile) return fail();
    response.writeHead(204).end();
    return true;
  }
  if (path === "/api/v1/stream") {
    if (!profile) return fail();
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    response.write(
      'event: ready\ndata: {"v":1,"connectionId":"01900000-0000-7000-8000-000000000003","heartbeatSeconds":25,"resumed":false}\n\n',
    );
    const interval = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    request.on("close", () => clearInterval(interval));
    return true;
  }
  if (
    await portfolioFixture(
      request,
      response,
      profile?.enrolled && profile.verified && !profile.required ? key : null,
    )
  )
    return true;
  let body = "";
  for await (const chunk of request) body += chunk;
  const data = body ? JSON.parse(body) : {};
  const cookie = (name, value, max = 3600) =>
    response.setHeader(
      "Set-Cookie",
      `__Host-oliginvest.${name}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${max}`,
    );
  if (path === "/api/v1/me/preferences" && request.method === "PATCH" && profile) {
    Object.assign(profile, data);
    saved.set(key, profile);
    return send(Object.fromEntries(Object.keys(preferences).map((k) => [k, profile[k]])));
  }
  if (path === "/api/v1/me/legal/acceptances" && profile) {
    profile.required = false;
    saved.set(key, profile);
    return send(legal(false));
  }
  if (path === "/api/v1/invitations/preview")
    return data.token?.length >= 32
      ? send({ emailMasked: "u***@example.test", role: "user", expiresAt: session.expiresAt })
      : fail("INVITATION_INVALID", 400);
  if (path === "/api/auth/sign-in/email") {
    if (data.password !== "fixture-password") return fail("UNAUTHENTICATED");
    cookie("two_factor", "fixture-challenge");
    return send({ twoFactorRedirect: true });
  }
  if (path === "/api/auth/sign-up/email") {
    cookie("session_token", `fixture-enroll-${randomUUID()}`);
    return send({ session, user: { ...user, twoFactorEnabled: false } });
  }
  if (path === "/api/auth/two-factor/enable")
    return send({
      totpURI: "otpauth://totp/OligInvest:fixture?secret=JBSWY3DPEHPK3PXP&issuer=OligInvest",
      backupCodes: codes,
    });
  if (
    path === "/api/auth/two-factor/verify-totp" ||
    path === "/api/auth/two-factor/verify-backup-code"
  ) {
    if (data.code !== "123456" && data.code !== "fixture-0000") return fail("MFA_REQUIRED", 403);
    cookie("session_token", `fixture-verified-${randomUUID()}`);
    return send({
      session,
      user,
      ...(key?.startsWith("fixture-enroll") ? { backupCodes: codes } : {}),
    });
  }
  if (path === "/api/auth/sign-out") {
    cookie("session_token", "", 0);
    return send({ status: true });
  }
  if (path === "/api/auth/request-password-reset" || path === "/api/auth/reset-password")
    return send({ status: true });
  return fail("NOT_FOUND", 404);
}
