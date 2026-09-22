import { loadConfig } from "@oliginvest/config";
import { createLogger, type PlatformLogger } from "@oliginvest/platform";
import { z } from "zod";
import { createApp } from "./app.js";
import { checkPostgres, checkValkey } from "./probes.js";

const host = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.:[\]_-]+$/u);
const port = z.coerce.number().int().min(1).max(65535);
const runtimeSchema = z
  .object({
    API_HOST: host,
    API_PORT: port,
    DB_HOST: host,
    DB_PORT: port,
    DB_NAME: z.string().min(1),
    DB_SSL: z.enum(["true", "false"]).default("false"),
    VALKEY_QUEUE_HOST: host,
    VALKEY_QUEUE_PORT: port,
    VALKEY_QUEUE_USER: z.string().min(1),
    VALKEY_CACHE_HOST: host,
    VALKEY_CACHE_PORT: port,
    VALKEY_CACHE_USER: z.string().min(1),
  })
  .strict();

export function createRuntime(
  env: Readonly<Record<string, string | undefined>>,
  logger: PlatformLogger = createLogger(),
) {
  const mode = z.enum(["development", "test", "production"]).parse(env.NODE_ENV ?? "development");
  const config = loadConfig("api", env, { mode });
  const runtime = runtimeSchema.parse(
    Object.fromEntries(Object.keys(runtimeSchema.shape).map((key) => [key, env[key] || undefined])),
  );
  const app = createApp({
    logger,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    checks: {
      postgres: () =>
        checkPostgres({
          host: runtime.DB_HOST,
          port: runtime.DB_PORT,
          database: runtime.DB_NAME,
          ssl: runtime.DB_SSL === "true",
          password: config.DB_APP_PASSWORD,
        }),
      valkeyQueue: () =>
        checkValkey({
          host: runtime.VALKEY_QUEUE_HOST,
          port: runtime.VALKEY_QUEUE_PORT,
          user: runtime.VALKEY_QUEUE_USER,
          password: config.VALKEY_QUEUE_API_PASSWORD,
        }),
      valkeyCache: () =>
        checkValkey({
          host: runtime.VALKEY_CACHE_HOST,
          port: runtime.VALKEY_CACHE_PORT,
          user: runtime.VALKEY_CACHE_USER,
          password: config.VALKEY_CACHE_API_PASSWORD,
        }),
    },
  });
  return { app, hostname: runtime.API_HOST, port: runtime.API_PORT };
}
