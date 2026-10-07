import type { ServiceConfig } from "@oliginvest/config";
import {
  authMailSchema,
  authSecurityEventSchema,
  invitationMailSchema,
  twoFactorResetMailSchema,
} from "@oliginvest/contracts";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { type PlatformLogger, subscribeFeatureFlags } from "@oliginvest/platform";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { Administration } from "./administration.js";
import { AuditWriter } from "./audit.js";
import { defaultPasswordChecks } from "./password.js";
import { AuthService } from "./service.js";
import { RedisAuthState } from "./state.js";

export function createAuthRuntime(
  config: ServiceConfig<"api">,
  settings: {
    DB_HOST: string;
    DB_PORT: number;
    DB_NAME: string;
    DB_SSL: "true" | "false";
    VALKEY_QUEUE_HOST: string;
    VALKEY_QUEUE_PORT: number;
    VALKEY_QUEUE_USER: string;
    VALKEY_CACHE_HOST: string;
    VALKEY_CACHE_PORT: number;
    VALKEY_CACHE_USER: string;
  },
  logger: PlatformLogger,
) {
  const databaseOptions = {
    host: settings.DB_HOST,
    port: settings.DB_PORT,
    database: settings.DB_NAME,
    ssl: settings.DB_SSL === "true",
  };
  const database = createAuthDatabase({ ...databaseOptions, password: config.DB_AUTH_PASSWORD });
  const appDatabase = createAppDatabase({ ...databaseOptions, password: config.DB_APP_PASSWORD });
  const connection = {
    host: settings.VALKEY_QUEUE_HOST,
    port: settings.VALKEY_QUEUE_PORT,
    username: settings.VALKEY_QUEUE_USER,
    password: config.VALKEY_QUEUE_API_PASSWORD,
    connectTimeout: 1500,
    commandTimeout: 1500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  };
  const state = new Redis({ ...connection, lazyConnect: true });
  const cacheConnection = {
    ...connection,
    host: settings.VALKEY_CACHE_HOST,
    port: settings.VALKEY_CACHE_PORT,
    username: settings.VALKEY_CACHE_USER,
    password: config.VALKEY_CACHE_API_PASSWORD,
    lazyConnect: true,
  };
  const cache = new Redis(cacheConnection);
  const subscriber = new Redis(cacheConnection);
  cache.on("error", () => logger.warn({ event: "auth.flags_unavailable" }));
  subscriber.on("error", () => logger.warn({ event: "auth.flags_subscription_unavailable" }));
  state.on("error", () => logger.error({ event: "auth.state_unavailable" }));
  const queues = new Map<string, Queue>();
  const queue = (name: string) => {
    let value = queues.get(name);
    if (!value) {
      value = new Queue(name, { connection });
      value.on("error", () => logger.error({ event: "auth.queue_unavailable" }));
      queues.set(name, value);
    }
    return value;
  };
  const service = new AuthService({
    database,
    appDatabase,
    configuration: {
      origin: new URL(config.PUBLIC_BASE_URL).origin,
      secrets: config.BETTER_AUTH_SECRETS.split(",").map((entry) => {
        const index = entry.indexOf(":");
        return {
          version: Number(entry.slice(0, index).trim()),
          value: entry.slice(index + 1).trim(),
        };
      }),
      trustedProxies: [],
      sendReset: async (message) => {
        await new RedisAuthState(state).limit(
          `password-reset:${message.email.toLowerCase()}`,
          1,
          3600,
        );
        await queue("notify").add(
          "auth.password-reset",
          authMailSchema.parse({ ...message, issuedAt: new Date().toISOString() }),
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      },
    },
    state: new RedisAuthState(state),
    passwordChecks: defaultPasswordChecks(() => logger.warn({ event: "auth.hibp_unavailable" })),
    audit: new AuditWriter(appDatabase, config.AUDIT_PSEUDONYM_KEY),
    securityEvent: async (event) => {
      await queue("events").add(event.kind, authSecurityEventSchema.parse(event), {
        removeOnComplete: true,
        removeOnFail: { age: 86400 },
      });
    },
    event: (event) => logger.warn({ event }),
  });
  void subscribeFeatureFlags(service.features, subscriber).catch(() =>
    logger.warn({ event: "auth.flags_subscription_unavailable" }),
  );
  return {
    service,
    appDatabase,
    cache,
    enqueueMarketSearch: async (query: string) => {
      const { createHash } = await import("node:crypto");
      await queue("ingest").add(
        "market.search",
        { query },
        {
          jobId: `search-${createHash("sha256").update(query).digest("hex")}`,
          removeOnComplete: { age: 30 * 86_400 },
          removeOnFail: { age: 3600 },
        },
      );
    },
    administration: new Administration(service, {
      resetMail: async (message) => {
        await queue("notify").add(
          "auth.two-factor-reset",
          twoFactorResetMailSchema.parse(message),
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      },
      inviteMail: async (message) => {
        await queue("notify").add("auth.invitation", invitationMailSchema.parse(message), {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: true,
        });
      },
      flagsChanged: async (keys) => {
        service.features.invalidate();
        await cache.publish("flags.changed", JSON.stringify({ keys }));
      },
      queues: async (action, name) => {
        const names = [
          "ingest",
          "import",
          "recompute",
          "alerts",
          "notify",
          "analytics",
          "analytics-results",
          "events",
        ];
        if (name && !names.includes(name)) throw new Error("Invalid queue");
        for (const target of name ? [name] : names) await queue(target)[action]();
      },
    }),
    close: async () => {
      await Promise.allSettled([...queues.values()].map((value) => value.close()));
      state.disconnect();
      subscriber.disconnect();
      cache.disconnect();
      await Promise.all([database.close(), appDatabase.close()]);
    },
  };
}
