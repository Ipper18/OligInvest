import { persistentEventSchema } from "@oliginvest/contracts";
import type { AppDatabase } from "@oliginvest/db";
import type { PlatformLogger } from "@oliginvest/platform";
import { type Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  enqueuePortfolioRecompute,
  ImportRepository,
  PortfolioRepository,
  parseImport,
  recomputePortfolio,
} from "./modules.js";
import type { readRuntime } from "./runtime.js";

export async function startPortfolioWorker(options: {
  database: AppDatabase;
  cache: Redis;
  queues: Queue[];
  connection: ReturnType<typeof readRuntime>["connection"];
  logger: PlatformLogger;
}) {
  const recompute = options.queues.find((q) => q.name === "recompute")!;
  const portfolio = new PortfolioRepository(options.database, async (payload) => {
    await enqueuePortfolioRecompute(recompute, payload);
  });
  const repository = new ImportRepository(portfolio, async () => {
    throw new Error("WORKER_CANNOT_UPLOAD");
  });
  const publish = async (userId: string, input: unknown) => {
    const event = persistentEventSchema.parse(input),
      key = `sse:${userId}`;
    await options.cache.xadd(
      key,
      "MAXLEN",
      "~",
      500,
      "*",
      "event",
      event.event,
      "data",
      JSON.stringify(event.data),
    );
    await options.cache.xtrim(key, "MINID", `${Date.now() - 600000}-0`);
    await options.cache.expire(key, 600);
  };
  const { commandTimeout: _timeout, ...connection } = options.connection;
  const worker = new Worker(
    "import",
    async (job) => {
      try {
        if (job.name !== "import.parse") throw new Error("UNKNOWN_JOB");
        await parseImport(repository, job.data, publish);
      } catch {
        options.logger.warn({ event: "portfolio.import_failed" });
        throw new Error("IMPORT_FAILED");
      }
    },
    { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 1 },
  );
  worker.on("error", () => options.logger.warn({ event: "portfolio.worker_unavailable" }));
  const enqueueAll = async (reason: "eod" | "fx" | "recompute", fromDate = "1970-01-01") => {
    z.iso.date().parse(fromDate);
    const users = await options.database.transaction(
      { userId: null, role: "system" },
      async (tx) =>
        (await tx.execute(sql`SELECT id::text,banned FROM identity.user_directory`)).rows,
    );
    for (const user of users) {
      const userId = z.uuid().parse(user.id);
      if (reason === "recompute")
        await options.database.transaction({ userId, role: "user" }, async (tx) => {
          await tx.execute(sql`DELETE FROM portfolio.import_files WHERE expires_at<=now()`);
        });
      if (user.banned) continue;
      await enqueuePortfolioRecompute(recompute, { userId, accountIds: [], fromDate, reason });
      if (reason === "recompute") {
        const pending = await options.database.transaction(
          { userId, role: "user" },
          async (tx) =>
            (
              await tx.execute(
                sql`SELECT b.id::text FROM portfolio.import_batches b JOIN portfolio.import_files f ON f.batch_id=b.id WHERE b.status IN ('uploaded','parsing') AND f.expires_at>now()`,
              )
            ).rows,
        );
        for (const batch of pending)
          await options.queues
            .find((q) => q.name === "import")!
            .add(
              "import.parse",
              { userId, importId: z.uuid().parse(batch.id) },
              {
                jobId: `import-${userId}-${batch.id}`,
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: "exponential", delay: 1000 },
              },
            );
      }
    }
  };
  const recomputeWorker = new Worker(
    "recompute",
    async (job) => {
      try {
        if (job.name === "portfolio.recompute-all") {
          z.object({}).strict().parse(job.data);
          await enqueueAll("recompute");
        } else if (job.name === "portfolio.recompute")
          await recomputePortfolio(portfolio, job.data, publish);
        else throw new Error("UNKNOWN_JOB");
      } catch {
        options.logger.warn({ event: "portfolio.recompute_failed" });
        throw new Error("RECOMPUTE_FAILED");
      }
    },
    { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 2 },
  );
  recomputeWorker.on("error", () => options.logger.warn({ event: "portfolio.worker_unavailable" }));
  try {
    await Promise.all([worker.waitUntilReady(), recomputeWorker.waitUntilReady()]);
    await recompute.upsertJobScheduler(
      "portfolio.recompute-all",
      { pattern: "0 3 * * *", tz: "Europe/Warsaw" },
      {
        name: "portfolio.recompute-all",
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: { age: 86400 },
        },
      },
    );
    return {
      enqueueAll,
      close: async () => {
        await Promise.all([worker.close(), recomputeWorker.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([worker.close(), recomputeWorker.close()]);
    throw error;
  }
}
