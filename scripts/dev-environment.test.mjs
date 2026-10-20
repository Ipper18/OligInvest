import assert from "node:assert/strict";
import { test } from "node:test";
import { childEnvironment } from "./dev-environment.mjs";
import { applicationEnvironment } from "./dev-services.mjs";

test("jobs receives database settings and local Mailpit, never other service secrets", () => {
  const env = applicationEnvironment({ NODE_ENV: "development", DEV_BIND_ADDRESS: "127.0.0.1", DEV_SMTP_PORT: "1025" });
  const jobs = childEnvironment(env, "jobs");
  for (const key of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_SSL", "DB_APP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD", "LEGAL_CONTROLLER_NAME"])
    assert.equal(jobs[key], env[key], key);
  for (const key of ["DB_AUTH_PASSWORD", "DB_ANALYTICS_RO_PASSWORD", "BETTER_AUTH_SECRETS", "VALKEY_QUEUE_API_PASSWORD"])
    assert.equal(jobs[key], undefined, key);
  assert.equal(jobs.SMTP_HOST, env.API_HOST);
  assert.equal(childEnvironment(env, "web").SMTP_PASSWORD, undefined);
});
