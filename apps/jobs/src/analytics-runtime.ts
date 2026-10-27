import { persistentEventSchema } from "@oliginvest/contracts";
import type { AppDatabase } from "@oliginvest/db";
import type { PlatformLogger } from "@oliginvest/platform";
import { QueueEvents, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { z } from "zod";
import { analyticsJobs } from "./modules.js";
import type { readRuntime } from "./runtime.js";

/**
 * BL-312: results of the Python worker (`analytics-results`) and its progress (`analytics` queue
 * events) are written under the run owner's RLS context and announced on `sse:{userId}`.
 */
export async function startAnalyticsWorker(options: {
  database: AppDatabase;
  cache: Redis;
  connection: ReturnType<typeof readRuntime>["connection"];
  logger: PlatformLogger;
  observe?: (worker: Worker) => void;
}) {
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
  if (!analyticsJobs) return { close: async () => {} };
  const results = analyticsJobs.createAnalyticsResults({ database: options.database, publish });
  const { commandTimeout: _timeout, ...connection } = options.connection;
  const blocking = { ...connection, maxRetriesPerRequest: null };
  const worker = new Worker(
    "analytics-results",
    async (job) => {
      try {
        if (job.name !== "analytics.result") throw new Error("UNKNOWN_JOB");
        await results.handleResult(job.data);
      } catch {
        // Never log the payload: it holds the user's distribution and assumptions.
        options.logger.warn({ event: "analytics.result_failed", module_id: "analytics" });
        throw new Error("ANALYTICS_RESULT_FAILED");
      }
    },
    { connection: blocking, concurrency: 2 },
  );
  worker.on("error", () => options.logger.warn({ event: "analytics.worker_unavailable" }));
  options.observe?.(worker);
  const events = new QueueEvents("analytics", { connection: blocking });
  events.on("error", () => options.logger.warn({ event: "analytics.events_unavailable" }));
  const runId = z.uuid();
  events.on("progress", ({ jobId, data }) => {
    if (!runId.safeParse(jobId).success) return;
    void results
      .handleProgress(jobId, data)
      .catch(() => options.logger.warn({ event: "analytics.progress_failed" }));
  });
  events.on("failed", ({ jobId }) => {
    if (!runId.safeParse(jobId).success) return;
    void results
      .handleWorkerFailure(jobId)
      .catch(() => options.logger.warn({ event: "analytics.failure_record_failed" }));
  });
  try {
    await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
    return {
      close: async () => {
        await Promise.allSettled([worker.close(), events.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([worker.close(), events.close()]);
    throw error;
  }
}
