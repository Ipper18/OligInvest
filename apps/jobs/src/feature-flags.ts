import type { ServiceConfig } from "@oliginvest/config";
import { createAppDatabase } from "@oliginvest/db";
import { FeatureFlags, type PlatformLogger, subscribeFeatureFlags } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { z } from "zod";

export function jobFeatureFlags(
  env: Readonly<Record<string, string | undefined>>,
  config: ServiceConfig<"jobs">,
  logger: PlatformLogger,
) {
  const schema = z
    .object({
      DB_HOST: z.string().min(1),
      DB_PORT: z.coerce.number().int().min(1).max(65535),
      DB_NAME: z.string().min(1),
      VALKEY_CACHE_HOST: z.string().min(1),
      VALKEY_CACHE_PORT: z.coerce.number().int().min(1).max(65535),
      VALKEY_CACHE_USER: z.string().min(1),
    })
    .strict();
  const settings = schema.parse(
    Object.fromEntries(Object.keys(schema.shape).map((key) => [key, env[key]])),
  );
  // Pool creation is lazy: foundations can start while the data plane is unavailable.
  const database = createAppDatabase({
    host: settings.DB_HOST,
    port: settings.DB_PORT,
    database: settings.DB_NAME,
    ssl: env.DB_SSL === "true",
    password: config.DB_APP_PASSWORD,
  });
  const flags = new FeatureFlags(() =>
    database.transaction(
      { userId: null, role: "system" },
      async (tx) =>
        (await tx.execute(sql`SELECT key,enabled,rules FROM platform.feature_flags`)).rows,
    ),
  );
  const subscriber = new Redis({
    host: settings.VALKEY_CACHE_HOST,
    port: settings.VALKEY_CACHE_PORT,
    username: settings.VALKEY_CACHE_USER,
    password: config.VALKEY_CACHE_JOBS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    commandTimeout: 1500,
    retryStrategy: () => null,
  });
  subscriber.on("error", () => logger.warn({ event: "jobs.flags_subscription_unavailable" }));
  void subscribeFeatureFlags(flags, subscriber).catch(() =>
    logger.warn({ event: "jobs.flags_subscription_unavailable" }),
  );
  return {
    flags,
    database,
    cache: subscriber.duplicate({ lazyConnect: true }),
    close: async () => {
      subscriber.disconnect();
      await database.close();
    },
  };
}
