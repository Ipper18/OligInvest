import { randomUUID } from "node:crypto";
import { currentRequest, ProblemError } from "@oliginvest/platform";
import { expect, test, vi } from "vitest";
import { createApp } from "../dist/app.js";

const names = ["postgres", "valkeyQueue", "valkeyCache"];
function fixture(failed = []) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const checks = Object.fromEntries(
    names.map((name) => [
      name,
      vi.fn(async () => {
        if (failed.includes(name)) throw new Error("private-host password=secret stack");
      }),
    ]),
  );
  return {
    app: createApp({ checks, logger, publicBaseUrl: "https://invest.example" }),
    checks,
    logger,
  };
}

test("live stays 200 without touching failed dependencies", async () => {
  const { app, checks } = fixture(names);
  const response = await app.request("/api/v1/health/live");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  for (const check of Object.values(checks)) expect(check).not.toHaveBeenCalled();
});

test.each([[], ...names.map((name) => [name]), names])(
  "ready reports only dependency states: %j",
  async (...args) => {
    const failed = args.filter((name) => typeof name === "string");
    const { app, checks, logger } = fixture(failed);
    const response = await app.request("/api/v1/health/ready");
    expect(response.status).toBe(failed.length ? 503 : 200);
    expect(await response.json()).toEqual({
      status: failed.length ? "fail" : "ok",
      checks: Object.fromEntries(
        names.map((name) => [name, failed.includes(name) ? "fail" : "ok"]),
      ),
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    if (failed.length) expect(response.headers.get("Retry-After")).toBe("1");
    for (const check of Object.values(checks)) expect(check).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private-host");
  },
);

test("Hono context, AsyncLocalStorage and response share a validated request ID", async () => {
  const { app } = fixture();
  app.get("/context", async (context) => {
    await Promise.resolve();
    return context.json({ hono: context.get("requestContext"), platform: currentRequest() });
  });
  const ids = [randomUUID(), randomUUID()];
  await Promise.all(
    ids.map(async (id) => {
      const response = await app.request("/context", { headers: { "X-Request-Id": id } });
      expect(response.headers.get("X-Request-Id")).toBe(id);
      expect(await response.json()).toEqual({
        hono: { requestId: id },
        platform: { requestId: id },
      });
    }),
  );
  const response = await app.request("/api/v1/health/live", {
    headers: { "X-Request-Id": "invalid" },
  });
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/u);
});

test.each([
  new Error("private-host password=secret"),
  new ProblemError("INTERNAL", { detail: "secret" }),
  "secret",
])("unexpected errors use redacted platform Problem Details", async (error) => {
  const { app, logger } = fixture();
  app.get("/failure", () => {
    throw error;
  });
  const response = await app.request("/failure?token=secret");
  expect(response.status).toBe(500);
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await response.json()).toEqual({
    type: "https://invest.example/problems/internal",
    title: "Błąd wewnętrzny",
    status: 500,
    code: "INTERNAL",
    instance: response.headers.get("X-Request-Id"),
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("unknown routes return correlated RFC 9457 errors", async () => {
  const { app } = fixture();
  const response = await app.request("/missing");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    code: "NOT_FOUND",
    instance: response.headers.get("X-Request-Id"),
  });
});

test("public OpenAPI 3.1 is generated from registered Zod routes", async () => {
  const { app } = fixture();
  const response = await app.request("/api/v1/openapi.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  const document = await response.json();
  expect(document.openapi).toBe("3.1.0");
  expect(Object.keys(document.paths).sort()).toEqual([
    "/health/live",
    "/health/ready",
    "/openapi.json",
  ]);
  expect(
    document.paths["/health/ready"].get.responses["503"].content["application/json"].schema,
  ).toEqual({ $ref: "#/components/schemas/HealthStatus" });
  expect(document.components.schemas.HealthStatus.properties.status.enum).toEqual(["ok", "fail"]);
  expect(document.servers).toEqual([{ url: "/api/v1" }]);
});
