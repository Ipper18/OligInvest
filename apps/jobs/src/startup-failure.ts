import { ConfigError, configSchemas } from "@oliginvest/config";
import type { LogEntry } from "@oliginvest/platform";
import { z } from "zod";

const keys = new Set([
  ...Object.keys(configSchemas.jobs.shape),
  "NODE_ENV",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_SSL",
  "VALKEY_QUEUE_HOST",
  "VALKEY_QUEUE_PORT",
  "VALKEY_QUEUE_USER",
  "VALKEY_CACHE_HOST",
  "VALKEY_CACHE_PORT",
  "VALKEY_CACHE_USER",
  "JOBS_INSTANCE_ID",
  "SMTP_PORT",
]);
const codes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EACCES"]);

// Only classifications and allowlisted field names; never message, stack, cause or input.
export function startupFailure(error: unknown): LogEntry {
  const event = "jobs.startup_failed";
  if (error instanceof ConfigError || error instanceof z.ZodError) {
    const key = error instanceof ConfigError ? error.issues[0]?.key : error.issues[0]?.path[0];
    return {
      event,
      error_class: error instanceof ConfigError ? "ConfigError" : "ZodError",
      code: "CONFIG_INVALID",
      ...(typeof key === "string" && keys.has(key) ? { config_key: key } : {}),
    };
  }
  const code =
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.has(error.code)
      ? error.code
      : "STARTUP_FAILED";
  return {
    event,
    error_class:
      error instanceof TypeError ? "TypeError" : error instanceof Error ? "Error" : "UnknownError",
    code,
  };
}
