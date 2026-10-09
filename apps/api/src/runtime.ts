import { loadConfig } from "@oliginvest/config";
import { createLogger, type PlatformLogger } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createApp } from "./app.js";
import { requestClientIp } from "./auth/client-ip.js";
import type { createAuthRuntime } from "./auth/runtime.js";
import { ImportRepository, MarketRepository, PortfolioRepository } from "./modules.js";
import { checkPostgres, checkValkey } from "./probes.js";
import { StreamStore } from "./stream-store.js";

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
): {
  app: ReturnType<typeof createApp>;
  hostname: string;
  port: number;
  close: () => Promise<void>;
} {
  const mode = z.enum(["development", "test", "production"]).parse(env.NODE_ENV);
  const config = loadConfig("api", env, { mode });
  const runtime = runtimeSchema.parse(
    Object.fromEntries(Object.keys(runtimeSchema.shape).map((key) => [key, env[key] || undefined])),
  );
  let auth: Promise<ReturnType<typeof createAuthRuntime>> | undefined;
  const getAuth = async () => {
    auth ??= import("./auth/runtime.js").then(({ createAuthRuntime }) =>
      createAuthRuntime(config, runtime, logger),
    );
    return auth;
  };
  let market: MarketRepository | undefined;
  let portfolio: PortfolioRepository | undefined;
  let stream: StreamStore | undefined;
  const app = createApp({
    portfolio: {
      imports: async () => {
        const runtime = await getAuth();
        portfolio ??= new PortfolioRepository(runtime.appDatabase, runtime.enqueueRecompute);
        return new ImportRepository(portfolio, runtime.enqueueImport);
      },
      repository: async () => {
        const runtime = await getAuth();
        portfolio ??= new PortfolioRepository(runtime.appDatabase, runtime.enqueueRecompute);
        return portfolio;
      },
      authorize: async (request, stepUp) => {
        const principal = await (await getAuth()).service.requireData(request, stepUp);
        return { userId: principal.user_id, role: principal.role };
      },
      assertOrigin: async (request) => (await getAuth()).service.assertOrigin(request),
    },
    stream: {
      origin: new URL(config.PUBLIC_BASE_URL).origin,
      authorize: async (request) => {
        const principal = await (await getAuth()).service.requireData(request);
        return { userId: principal.user_id, sessionId: principal.id };
      },
      store: async () => {
        stream ??= new StreamStore((await getAuth()).cache);
        return stream;
      },
      ownedInstruments: async (owner) =>
        (await getAuth()).appDatabase.transaction(
          { userId: owner.userId, role: "user" },
          async (tx) =>
            (
              await tx.execute(
                sql`SELECT instrument_id::text FROM market.watchlist_items UNION SELECT instrument_id::text FROM portfolio.positions_daily p WHERE quantity>0 AND valuation_date=(SELECT max(valuation_date) FROM portfolio.positions_daily WHERE account_id=p.account_id)`,
              )
            ).rows.map((row) => String(row.instrument_id)),
        ),
    },
    market: {
      repository: async () => {
        market ??= new MarketRepository((await getAuth()).appDatabase);
        return market;
      },
      authorize: async (request) => {
        const principal = await (await getAuth()).service.requireData(request);
        return { userId: principal.user_id, role: principal.role };
      },
      searchInBackground: async (query) => (await getAuth()).enqueueMarketSearch(query),
    },
    auth: {
      service: async () => {
        return (await getAuth()).service;
      },
      administration: async () => (await getAuth()).administration,
      clientIp: requestClientIp(
        (env.API_TRUSTED_PROXY_CIDRS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    },
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
  return {
    app,
    hostname: runtime.API_HOST,
    port: runtime.API_PORT,
    close: async () => {
      await (await auth)?.close();
    },
  };
}
