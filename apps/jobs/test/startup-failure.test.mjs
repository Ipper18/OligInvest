import { ConfigError } from "@oliginvest/config";
import { createLogger } from "@oliginvest/platform";
import { expect, test } from "vitest";
import { z } from "zod";
import { jobFeatureFlags } from "../dist/feature-flags.js";
import { startupFailure } from "../dist/startup-failure.js";

test("missing database variable survives to the structured log without values", () => {
  let error;
  try {
    jobFeatureFlags({}, {}, {});
  } catch (failure) {
    error = failure;
  }
  expect(startupFailure(error)).toEqual({
    event: "jobs.startup_failed",
    error_class: "ZodError",
    code: "CONFIG_INVALID",
    config_key: "DB_HOST",
  });
});

test("startup diagnostics permit only classifications and known configuration keys", () => {
  const secret = "synthetic-sensitive-value";
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  const errors = [
    new Error(secret),
    Object.assign(new Error(secret), { code: secret }),
    new ConfigError([{ key: "SMTP_FROM", code: secret }]),
    new ConfigError([{ key: secret, code: secret }]),
    z.object({ DB_APP_PASSWORD: z.number() }).safeParse({ DB_APP_PASSWORD: secret }).error,
  ];
  for (const error of errors) logger.error(startupFailure(error));
  expect(lines.join("")).not.toContain(secret);
  expect(lines.join("")).toContain('"config_key":"SMTP_FROM"');
  expect(startupFailure(Object.assign(new Error(secret), { code: "ECONNREFUSED" })).code).toBe(
    "ECONNREFUSED",
  );
});
