// Logout must delete the session cookies unambiguously in every browser: an expiry in the past,
// never `Max-Age=0` (expiry == "now", which Firefox could still list for that second).
import { ResponseCookies } from "next/dist/compiled/@edge-runtime/cookies/index.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ jar: undefined }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => state.jar,
  headers: async () => new Headers({ cookie: "__Host-oliginvest.session_token=fixture" }),
}));
const { relayAction } = await import("../src/auth/relay.ts");

let response;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_BASE_URL", "https://example.test/");
  vi.stubEnv("API_INTERNAL_URL", "http://api.example.test:4000");
  response = new Headers();
  const written = new ResponseCookies(response);
  // Route-handler jar: reads the request cookies, writes the response cookies.
  state.jar = {
    getAll: () => [
      { name: "__Host-oliginvest.session_token", value: "fixture" },
      { name: "__Host-oliginvest.two_factor", value: "fixture" },
      { name: "oi-locale", value: "pl-PL" },
    ],
    set: (...args) => written.set(...args),
    delete: (...args) => written.delete(...args),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectDeleted(name) {
  const header = response.getSetCookie().find((c) => c.startsWith(`${name}=`));
  expect(header).toBeDefined();
  expect(header).toMatch(new RegExp(`^${name.replaceAll(".", "\\.")}=;`, "u"));
  expect(header).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  expect(header).not.toMatch(/Max-Age/iu);
  expect(header).toMatch(/Path=\//u);
  expect(header).toMatch(/Secure/u);
  expect(header).toMatch(/HttpOnly/u);
}

test("sign-out expires every session cookie in the past, without Max-Age=0", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { status: true },
      {
        headers: [
          ["set-cookie", "__Host-oliginvest.session_token=; Path=/; Max-Age=0; Secure; HttpOnly"],
        ],
      },
    ),
  );
  expect((await relayAction("signOut", {})).ok).toBe(true);
  expectDeleted("__Host-oliginvest.session_token");
  expectDeleted("__Host-oliginvest.two_factor");
  expect(response.getSetCookie().some((c) => c.startsWith("oi-locale="))).toBe(false);
});

test("sign-out clears the cookies even when the API is unreachable", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("fetch failed");
  });
  expect((await relayAction("signOut", {})).ok).toBe(false);
  expectDeleted("__Host-oliginvest.session_token");
  expectDeleted("__Host-oliginvest.two_factor");
});

test("an upstream Max-Age=0 deletion is relayed as an expiry in the past", async () => {
  const verified = {
    session: {
      id: "01900000-0000-7000-8000-000000000002",
      expiresAt: "2027-01-01T00:00:00Z",
      mfaVerifiedAt: "2026-10-12T00:00:00Z",
    },
    user: {
      id: "01900000-0000-7000-8000-000000000001",
      email: "ui@example.test",
      name: "UI fixture",
      role: "user",
      twoFactorEnabled: true,
    },
  };
  vi.stubGlobal("fetch", async () =>
    Response.json(verified, {
      headers: [
        ["set-cookie", "__Host-oliginvest.two_factor=; Path=/; Max-Age=0; Secure; HttpOnly"],
        [
          "set-cookie",
          "__Host-oliginvest.session_token=fresh; Path=/; Max-Age=3600; Secure; HttpOnly",
        ],
      ],
    }),
  );
  expect((await relayAction("totp", { code: "123456" })).ok).toBe(true);
  expectDeleted("__Host-oliginvest.two_factor");
  const session = response
    .getSetCookie()
    .find((c) => c.startsWith("__Host-oliginvest.session_token="));
  expect(session).toMatch(/^__Host-oliginvest\.session_token=fresh;/u);
  expect(session).toContain("Max-Age=3600");
});
