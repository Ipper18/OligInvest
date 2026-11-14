import { createHmac } from "node:crypto";
import { isAbsolute } from "node:path";
import { persistentEventSchema } from "@oliginvest/contracts";
import type { AppDatabase } from "@oliginvest/db";
import { privacyMessages } from "@oliginvest/i18n";
import { copies } from "@oliginvest/i18n/en";
import type { Metrics, PlatformLogger } from "@oliginvest/platform";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { z } from "zod";
import { identityJobs } from "./modules.js";
import type { readRuntime } from "./runtime.js";

const {
  ACCOUNT_ERASURE_JOB,
  DATA_EXPORT_JOB,
  IDENTITY_QUEUE,
  eraseDueAccounts,
  processDataExport,
  reEraseRestoredAccounts,
  syncErasureFile,
} = identityJobs;

/** Absolute path of the bind-mounted `erasure-log.jsonl` (backup-dr.md § 7); unset = no erasure. */
export function erasureFilePath(env: Readonly<Record<string, string | undefined>>) {
  const path = env.ERASURE_LOG_FILE;
  if (path === undefined || path === "") return undefined;
  if (!isAbsolute(path) || path.includes("\0")) throw new Error("ERASURE_LOG_FILE_INVALID");
  return path;
}

export function exportReadme(locale: string) {
  return locale === "en-US" ? copies.privacyMessages.readme : privacyMessages.readme;
}

/**
 * Daily erasure run: accounts whose 14-day grace period ended are erased, then the identifier file
 * outside the database is synchronized. Counts only reach logs and metrics (no identifiers).
 */
export async function runErasure(options: {
  database: AppDatabase;
  pseudonymKey: string;
  file: string | undefined;
  logger: PlatformLogger;
  metrics?: Metrics;
}) {
  if (!options.file) {
    // Without the file a restored backup could resurrect the account (backup-dr.md § 7): fail closed.
    options.logger.error({ event: "erasure.file_not_configured", code: "ERASURE_FILE_MISSING" });
    throw new Error("ERASURE_FILE_MISSING");
  }
  const started = Date.now();
  // The file must be writable before anything is erased; a failure here leaves accounts untouched.
  const before = await syncErasureFile(options.database, options.file);
  const restored = await reEraseRestoredAccounts(options.database, before.unrecorded);
  if (restored) {
    options.metrics?.add("erasure_restored_accounts_total", {}, restored);
    options.logger.warn({ event: "erasure.restored_accounts", code: "ERASURE_REAPPLIED" });
  }
  const erased = await eraseDueAccounts(options.database, (value) =>
    createHmac("sha256", options.pseudonymKey).update(value).digest("hex"),
  );
  const file = await syncErasureFile(options.database, options.file);
  options.metrics?.add("erasure_accounts_total", {}, erased.length);
  options.metrics?.gauge("erasure_file_invalid_lines", {}, file.invalid);
  if (file.invalid)
    options.logger.error({ event: "erasure.file_invalid_lines", code: "ERASURE_FILE_DAMAGED" });
  options.logger.info({ event: "erasure.completed", duration_ms: Date.now() - started });
}

export async function startIdentityWorker(options: {
  database: AppDatabase;
  cache: Redis;
  connection: ReturnType<typeof readRuntime>["connection"];
  logger: PlatformLogger;
  metrics?: Metrics;
  pseudonymKey: string;
  erasureFile: string | undefined;
  observe?: (worker: Worker) => void;
}) {
  const publish = async (userId: string, exportId: string) => {
    const event = persistentEventSchema.parse({
      event: "identity.export.ready",
      data: { v: 1, exportId },
    });
    const key = `sse:${userId}`;
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
  const blocking = { ...connection, maxRetriesPerRequest: null };
  const worker = new Worker(
    IDENTITY_QUEUE,
    async (job) => {
      if (job.name === DATA_EXPORT_JOB) {
        const result = await processDataExport(options.database, job.data, {
          readme: exportReadme,
        });
        options.metrics?.add("gdpr_exports_total", { result: result.status });
        if (result.status === "failed")
          options.logger.warn({ event: "identity.export_failed", module_id: "identity" });
        // Both outcomes are announced: the client reloads the export status either way.
        if (result.status !== "skipped")
          await publish(result.userId, result.exportId).catch(() =>
            options.logger.warn({ event: "identity.export_event_failed" }),
          );
        return;
      }
      if (job.name === ACCOUNT_ERASURE_JOB) {
        z.object({}).strict().parse(job.data);
        await runErasure({
          database: options.database,
          pseudonymKey: options.pseudonymKey,
          file: options.erasureFile,
          logger: options.logger,
          ...(options.metrics ? { metrics: options.metrics } : {}),
        });
        return;
      }
      throw new Error("UNKNOWN_JOB");
    },
    { connection: blocking, concurrency: 1 },
  );
  worker.on("error", () => options.logger.warn({ event: "identity.worker_unavailable" }));
  options.observe?.(worker);
  const queue = new Queue(IDENTITY_QUEUE, { connection: options.connection });
  queue.on("error", () => options.logger.warn({ event: "identity.queue_unavailable" }));
  try {
    await Promise.all([worker.waitUntilReady(), queue.waitUntilReady()]);
    // Also once at start-up: after a restore the re-erasure runs before the nightly window.
    await queue.add(
      ACCOUNT_ERASURE_JOB,
      {},
      {
        deduplication: { id: `${ACCOUNT_ERASURE_JOB}.startup` },
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * 86400 },
      },
    );
    await queue.upsertJobScheduler(
      ACCOUNT_ERASURE_JOB,
      { pattern: "30 3 * * *", tz: "Europe/Warsaw" },
      {
        name: ACCOUNT_ERASURE_JOB,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 86400 },
        },
      },
    );
    return {
      close: async () => {
        await Promise.allSettled([worker.close(), queue.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([worker.close(), queue.close()]);
    throw error;
  }
}
