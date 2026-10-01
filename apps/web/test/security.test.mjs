import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { proxy } from "../src/proxy.ts";

afterEach(() => vi.unstubAllEnvs());

test("production overwrites untrusted CSP/nonce and creates fresh matching nonces", () => {
  vi.stubEnv("NODE_ENV", "production");
  const responses = Array.from({ length: 8 }, () =>
    proxy(
      new NextRequest("https://example.test/", {
        headers: {
          "x-nonce": "injected",
          "content-security-policy": "injected",
          "x-request-id": "invalid",
        },
      }),
    ),
  );
  const nonces = responses.map((response) => {
    const csp = response.headers.get("content-security-policy");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:|injected/);
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = csp.match(/'nonce-([^']+)'/)[1];
    expect(Buffer.from(nonce, "base64").length).toBeGreaterThanOrEqual(16);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    return nonce;
  });
  expect(new Set(nonces).size).toBe(responses.length);
});

test("preserves a UUID correlation id and limits eval exception to development", () => {
  vi.stubEnv("NODE_ENV", "development");
  const id = crypto.randomUUID();
  const response = proxy(new NextRequest("http://localhost/", { headers: { "x-request-id": id } }));
  expect(response.headers.get("x-request-id")).toBe(id);
  expect(response.headers.get("content-security-policy")).toContain("'unsafe-eval'");
  expect(response.headers.get("content-security-policy")).not.toContain("'unsafe-inline'");
});
