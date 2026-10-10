import { ProviderError } from "@oliginvest/data-providers";
import type { AppDatabase } from "@oliginvest/db";
import type { PlatformLogger } from "@oliginvest/platform";
import { DelayedError, type Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { z } from "zod";
import { createMarketJobs, marketSchedules } from "./modules.js";
import type { readRuntime } from "./runtime.js";

export async function startMarketWorker(options: {
  database: AppDatabase;
  cache: Redis;
  queue: Queue;
  connection: ReturnType<typeof readRuntime>["connection"];
  logger: PlatformLogger;
  updated?(reason: "eod" | "fx", fromDate: string): Promise<void>;
}) {
  const redis = new Redis(options.connection);
  redis.on("error", () => options.logger.warn({ event: "market.queue_unavailable" }));
  options.cache.on("error", () => options.logger.warn({ event: "market.cache_unavailable" }));
  const observed = async () => {
    const users = await options.database.transaction(
      { userId: null, role: "system" },
      async (tx) =>
        (await tx.execute(sql`SELECT id::text FROM identity.user_directory WHERE NOT banned`)).rows,
    );
    const ids = new Set<string>();
    for (const user of users) {
      const userId = z.uuid().parse(user.id);
      const rows = await options.database.transaction(
        { userId, role: "user" },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT instrument_id::text FROM market.watchlist_items UNION SELECT instrument_id::text FROM portfolio.positions_daily p WHERE quantity>0 AND valuation_date=(SELECT max(valuation_date) FROM portfolio.positions_daily WHERE account_id=p.account_id)`,
            )
          ).rows,
      );
      for (const row of rows) ids.add(String(row.instrument_id));
      const connections = await options.cache.zrangebyscore(
        `sse:connections:${userId}`,
        Date.now(),
        "+inf",
      );
      for (const id of connections) {
        const raw = await options.cache.get(`sse:connection:${userId}:${id}`);
        if (!raw) continue;
        const parsed = z
          .object({
            userId: z.literal(userId),
            sessionId: z.string(),
            instruments: z.array(z.uuid()).max(50),
          })
          .strict()
          .safeParse(JSON.parse(raw));
        if (parsed.success) for (const instrument of parsed.data.instruments) ids.add(instrument);
      }
    }
    // Resolve only explicit Yahoo mappings; never guess provider symbols.
    return options.database.transaction({ userId: null, role: "system" }, async (tx) =>
      (
        await tx.execute(
          sql`SELECT DISTINCT i.id::text FROM market.instruments i JOIN market.instrument_provider_symbols s ON s.instrument_id=i.id AND s.provider='yahoo' WHERE i.id=ANY(${sql.param([...ids])}::uuid[]) AND i.is_active`,
        )
      ).rows.map((row) => String(row.id)),
    );
  };
  const enqueue = async (name: string, payload: unknown, delay = 0) => {
    await options.queue.add(name, payload, {
      delay,
      attempts: 11,
      backoff: { type: "fixed", delay: 600_000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
    });
  };
  const market = createMarketJobs({
    database: options.database,
    cache: options.cache,
    queue: redis,
    observed,
    enqueue,
  });
  for (const schedule of marketSchedules)
    await options.queue.upsertJobScheduler(
      schedule.job,
      { pattern: schedule.cron, tz: schedule.tz },
      {
        name: schedule.job,
        data: {},
        opts: {
          attempts: schedule.job === "market.fx" ? 11 : 3,
          backoff: { type: "fixed", delay: 600_000 },
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      },
    );
  const { commandTimeout: _t, ...connection } = options.connection;
  const worker = new Worker(
    "ingest",
    async (job, token) => {
      try {
        if (job.repeatJobKey && !job.data.scheduledAt) {
          const scheduled = new Date(job.opts.prevMillis ?? job.timestamp);
          const date = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Warsaw",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(scheduled);
          await job.updateData({ ...job.data, date, scheduledAt: scheduled.toISOString() });
        }
        await market.dispatch(job.name, job.data, job.attemptsMade);
        if (
          ["market.fx", "market.gpw", "market.gpw-backfill", "market.us-eod"].includes(job.name)
        ) {
          await options.updated?.(
            job.name === "market.fx" ? "fx" : "eod",
            // Providers can revise earlier bars/rates in their overlapping fetch window.
            job.data.from ?? "1970-01-01",
          );
        }
      } catch (error) {
        if (error instanceof ProviderError && error.reason === "provider_quota") {
          await job.moveToDelayed(Date.now() + Math.max(error.retryAfterMs, 1000), token);
          throw new DelayedError();
        }
        options.logger.warn({ event: "market.ingestion_failed", module_id: "market" });
        throw new Error("MARKET_INGESTION_FAILED");
      }
    },
    { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 2 },
  );
  worker.on("error", () => options.logger.warn({ event: "market.worker_unavailable" }));
  await worker.waitUntilReady();
  return {
    close: async () => {
      await worker.close();
      redis.disconnect();
      options.cache.disconnect();
    },
  };
}
