import { randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";

const probes = vi.hoisted(() => ({ checkPostgres: vi.fn(), checkValkey: vi.fn() }));
vi.mock("../dist/probes.js", () => probes);
const { createRuntime } = await import("../dist/runtime.js");
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function environment() {
  const secret = () => randomBytes(32).toString("hex");
  return {
    NODE_ENV: "test",
    PUBLIC_BASE_URL: "https://invest.example",
    BETTER_AUTH_SECRETS: `0:${secret()}`,
    AUDIT_PSEUDONYM_KEY: secret(),
    DB_AUTH_PASSWORD: secret(),
    DB_APP_PASSWORD: secret(),
    VALKEY_QUEUE_API_PASSWORD: secret(),
    VALKEY_CACHE_API_PASSWORD: secret(),
    API_HOST: "localhost",
    API_PORT: "3001",
    DB_HOST: "postgres.example",
    DB_PORT: "5432",
    DB_NAME: "synthetic",
    DB_SSL: "true",
    VALKEY_QUEUE_HOST: "queue.example",
    VALKEY_QUEUE_PORT: "6379",
    VALKEY_QUEUE_USER: "api",
    VALKEY_CACHE_HOST: "cache.example",
    VALKEY_CACHE_PORT: "6380",
    VALKEY_CACHE_USER: "api",
  };
}
afterEach(() => vi.resetAllMocks());

test("runtime wires distinct authenticated probes and keeps startup/liveness independent", async () => {
  const env = environment();
  const { app, hostname, port } = createRuntime(env, logger);
  expect({ hostname, port }).toEqual({ hostname: "localhost", port: 3001 });
  expect((await app.request("/api/v1/health/live")).status).toBe(200);
  expect(probes.checkPostgres).not.toHaveBeenCalled();
  expect(probes.checkValkey).not.toHaveBeenCalled();
  expect((await app.request("/api/v1/health/ready")).status).toBe(200);
  expect(probes.checkPostgres).toHaveBeenCalledWith({
    host: env.DB_HOST,
    port: 5432,
    database: env.DB_NAME,
    password: env.DB_APP_PASSWORD,
    ssl: true,
  });
  expect(probes.checkValkey).toHaveBeenNthCalledWith(1, {
    host: env.VALKEY_QUEUE_HOST,
    port: 6379,
    user: "api",
    password: env.VALKEY_QUEUE_API_PASSWORD,
  });
  expect(probes.checkValkey).toHaveBeenNthCalledWith(2, {
    host: env.VALKEY_CACHE_HOST,
    port: 6380,
    user: "api",
    password: env.VALKEY_CACHE_API_PASSWORD,
  });
});

test("readiness recovers on the next request after a dependency failure", async () => {
  probes.checkValkey.mockRejectedValueOnce(new Error("private details"));
  const { app } = createRuntime(environment(), logger);
  const failed = await app.request("/api/v1/health/ready");
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    status: "fail",
    checks: { postgres: "ok", valkeyQueue: "fail", valkeyCache: "ok" },
  });
  expect((await app.request("/api/v1/health/ready")).status).toBe(200);
});

test.each([
  { API_PORT: "0" },
  { DB_PORT: "65536" },
  { DB_HOST: "" },
  { DB_SSL: "invalid" },
  { VALKEY_QUEUE_USER: "" },
  { NODE_ENV: "invalid" },
  { NODE_ENV: "production" },
])("invalid runtime configuration fails before any probe: %j", (override) => {
  expect(() => createRuntime({ ...environment(), ...override }, logger)).toThrow();
  expect(probes.checkPostgres).not.toHaveBeenCalled();
  expect(probes.checkValkey).not.toHaveBeenCalled();
});
