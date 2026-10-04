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
  // Pool creation is lazy: foundations can start while the data plane is unavailable.
  const database = createAppDatabase({
    host: z.string().min(1).parse(env.DB_HOST),
    port: z.coerce.number().int().min(1).max(65535).parse(env.DB_PORT),
    database: z.string().min(1).parse(env.DB_NAME),
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
    host: z.string().min(1).parse(env.VALKEY_CACHE_HOST),
    port: z.coerce.number().int().min(1).max(65535).parse(env.VALKEY_CACHE_PORT),
    username: z.string().min(1).parse(env.VALKEY_CACHE_USER),
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
    close: async () => {
      subscriber.disconnect();
      await database.close();
    },
  };
}
