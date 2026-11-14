// ZAP 10010: the language cookie of public pages is written only by the server and always HttpOnly
// (proxy.ts syncs it from /me, relay.ts after saved preferences); no client script writes it.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => jar,
  headers: async () => new Headers({ cookie: "__Host-oliginvest.session_token=fixture" }),
}));
const { relayAction } = await import("../src/auth/relay.ts");

const preferences = {
  baseCurrency: "PLN",
  costBasisMethod: "fifo",
  plView: "economic",
  taxDateBasis: "settlement",
  taxIncludeFxFee: true,
  timezone: "Europe/Warsaw",
  locale: "en-US",
  theme: "system",
  plPalette: "default",
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLIC_BASE_URL", "https://example.test/");
  vi.stubEnv("API_INTERNAL_URL", "http://api.example.test:4000");
  jar.set.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("saved preferences set the HttpOnly language cookie on the action response", async () => {
  vi.stubGlobal("fetch", async () => Response.json(preferences));
  expect((await relayAction("preferences", { locale: "en-US" })).ok).toBe(true);
  expect(jar.set).toHaveBeenCalledWith("oi-locale", "en-US", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
});

test("a rejected preferences change leaves the language cookie untouched", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { type: "about:blank", title: "Invalid", status: 422, code: "VALIDATION_FAILED" },
      { status: 422 },
    ),
  );
  expect((await relayAction("preferences", { locale: "en-US" })).ok).toBe(false);
  expect(jar.set).not.toHaveBeenCalled();
});

test("no client code writes the language cookie", () => {
  const settings = readFileSync(new URL("../src/appearance/settings.tsx", import.meta.url), "utf8");
  expect(settings).not.toMatch(/document\.cookie/u);
});
