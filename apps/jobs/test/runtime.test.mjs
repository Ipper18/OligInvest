import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@oliginvest/platform";
import { expect, test } from "vitest";
import { createQueueRegistry, readRuntime } from "../dist/index.js";

export const environment = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://localhost:3000",
  AUDIT_PSEUDONYM_KEY: "x".repeat(32),
  DB_APP_PASSWORD: "synthetic",
  VALKEY_QUEUE_JOBS_PASSWORD: "synthetic",
  VALKEY_CACHE_JOBS_PASSWORD: "synthetic",
  VALKEY_QUEUE_HOST: "localhost",
  VALKEY_QUEUE_PORT: "6379",
  VALKEY_QUEUE_USER: "default",
  JOBS_INSTANCE_ID: "test",
};

test("queue catalog matches module contract without domain handlers or schedules", async () => {
  const { registry, queues } = createQueueRegistry();
  expect(queues.map(({ name, concurrency }) => [name, concurrency])).toEqual([
    ["ingest", 2],
    ["import", 1],
    ["recompute", 2],
    ["alerts", 2],
    ["notify", 4],
    ["analytics", 1],
    ["analytics-results", 2],
    ["events", 4],
  ]);
  expect(await registry.schedules({})).toEqual([]);
  expect(registry.entries().every(({ handlers }) => Object.keys(handlers).length === 0)).toBe(true);
  expect(Object.isFrozen(registry.entries()[0])).toBe(true);
});

test("NODE_ENV is explicit and production rejects inline secrets and HTTP", () => {
  expect(readRuntime(environment).mode).toBe("test");
  for (const NODE_ENV of [undefined, "", "prod", "production"]) {
    expect(() => readRuntime({ ...environment, NODE_ENV })).toThrow();
  }
  for (const VALKEY_QUEUE_PORT of ["0", "65536", "invalid"]) {
    expect(() => readRuntime({ ...environment, VALKEY_QUEUE_PORT })).toThrow();
  }
  expect(() => readRuntime({ ...environment, JOBS_INSTANCE_ID: "a:b" })).toThrow();
});

test("logger does not expose arbitrary connection failures", () => {
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  logger.error({ event: "jobs.connection_failed", password: "synthetic-sensitive" });
  expect(lines.join("")).not.toContain("synthetic-sensitive");
});

test("production accepts file secrets with HTTPS", () => {
  const directory = mkdtempSync(join(tmpdir(), "oliginvest-jobs-"));
  try {
    const env = {
      ...environment,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://example.invalid",
    };
    for (const key of [
      "AUDIT_PSEUDONYM_KEY",
      "DB_APP_PASSWORD",
      "VALKEY_QUEUE_JOBS_PASSWORD",
      "VALKEY_CACHE_JOBS_PASSWORD",
    ]) {
      const path = join(directory, key);
      writeFileSync(path, env[key]);
      delete env[key];
      env[`${key}_FILE`] = path;
    }
    expect(readRuntime(env).mode).toBe("production");
    expect(() => readRuntime({ ...env, PUBLIC_BASE_URL: "http://example.invalid" })).toThrow();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
