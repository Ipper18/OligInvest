import { persistentEventSchema } from "@oliginvest/contracts";
import type { AppDatabase } from "@oliginvest/db";
import type { PlatformLogger } from "@oliginvest/platform";
import { type Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { ImportRepository, PortfolioRepository, parseImport } from "./modules.js";
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
    await recompute.add("portfolio.recompute", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: { age: 86400 },
    });
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
  await worker.waitUntilReady();
  return { close: () => worker.close() };
}
