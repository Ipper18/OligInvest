import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { applicationErrorSchema } from "@oliginvest/contracts";
import type { AppDatabase } from "@oliginvest/db";
import { Metrics, type PlatformLogger } from "@oliginvest/platform";
import type { Job, Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { z } from "zod";
import type { readRuntime } from "./runtime.js";

const RETENTION = 7 * 86400;
const prefix = "bull:notify:monitoring:";
const daySchema = z.iso.date();
export function reportDay(timestamp = Date.now()) {
  return new Date(timestamp - 86400000).toISOString().slice(0, 10);
}
export function errorGroup(input: unknown) {
  const event = applicationErrorSchema.parse(input);
  return { event, key: `${event.source}|${event.operation}|${event.code}` };
}
export function reportText(
  day: string,
  counts: Record<string, string>,
  samples: Record<string, string>,
) {
  daySchema.parse(day);
  const lines = [
    `Raport błędów OligInvest — ${day} (UTC)`,
    "Liczba nieudanych żądań i prób zadań:",
  ];
  for (const [key, count] of Object.entries(counts).sort()) {
    const [source, operation, code] = key.split("|");
    errorGroup({ source, operation, code, occurredAt: `${day}T00:00:00.000Z` });
    if (!/^\d{1,12}$/.test(count)) throw new Error("INVALID_ERROR_COUNT");
    lines.push(`${source} ${operation} ${code}: ${count}`);
    const ids = (samples[key] ?? "")
      .split(",")
      .filter(Boolean)
      .slice(0, 3)
      .map((id) => z.uuid().parse(id));
    if (ids.length) lines.push(`Identyfikatory żądań: ${ids.join(", ")}`);
  }
  if (!Object.keys(counts).length) lines.push("Brak zarejestrowanych błędów.");
  return lines.join("\n");
}
export function observeWorker(
  worker: Worker,
  metrics: Metrics,
  record: (input: unknown) => Promise<void>,
  logger: PlatformLogger,
) {
  const observe = (job: Job | undefined, failed: boolean) => {
    if (!job || job.name.startsWith("monitoring.")) return;
    const type = /^[a-z][a-z.-]{0,70}$/.test(job.name) ? job.name : "unknown";
    metrics.duration(
      "job_duration_seconds",
      { queue: worker.name, type },
      Math.max(0, Date.now() - (job.processedOn ?? Date.now())) / 1000,
    );
    if (failed)
      void record({
        source: "jobs",
        operation: `${worker.name}/${type}`,
        code: [
          "IMPORT_FAILED",
          "RECOMPUTE_FAILED",
          "MARKET_INGESTION_FAILED",
          "AUTH_MAIL_DELIVERY_FAILED",
        ].includes(job.failedReason)
          ? job.failedReason
          : "JOB_FAILED",
        occurredAt: new Date().toISOString(),
      }).catch(() => {
        metrics.add("monitoring_record_failures_total");
        logger.error({ event: "monitoring.record_failed" });
      });
  };
  worker.on("completed", (job) => observe(job, false));
  worker.on("failed", (job) => observe(job, true));
}
export async function startMonitoring(options: {
  connection: ReturnType<typeof readRuntime>["connection"];
  queues: Queue[];
  database: AppDatabase;
  cache: Redis;
  logger: PlatformLogger;
  host: string;
  port: number;
  send: (email: string, subject: string, text: string) => Promise<void>;
}) {
  const redis = new Redis(options.connection);
  redis.on("error", () => options.logger.error({ event: "monitoring.storage_failed" }));
  const metrics = new Metrics();
  const notify = options.queues.find((queue) => queue.name === "notify");
  if (!notify) {
    redis.disconnect();
    throw new Error("NOTIFY_QUEUE_REQUIRED");
  }
  const record = async (input: unknown) => {
    const { event, key } = errorGroup(input);
    const day = event.occurredAt.slice(0, 10);
    const age = Date.now() - Date.parse(event.occurredAt);
    if (age < -60000 || age > RETENTION * 1000) throw new Error("ERROR_EVENT_EXPIRED");
    // Atomic counts and bounded samples; no read/modify/write race between worker processes.
    await redis.eval(
      `local n=redis.call('HINCRBY',KEYS[1],ARGV[1],1)
      redis.call('EXPIRE',KEYS[1],ARGV[3])
      if n<=3 and ARGV[2]~='' then
        local s=redis.call('HGET',KEYS[2],ARGV[1])
        redis.call('HSET',KEYS[2],ARGV[1],s and s..','..ARGV[2] or ARGV[2])
        redis.call('EXPIRE',KEYS[2],ARGV[3])
      end return n`,
      2,
      `${prefix}${day}:counts`,
      `${prefix}${day}:samples`,
      key,
      event.requestId ?? "",
      RETENTION,
    );
  };
  const daily = async (timestamp: number) => {
    const day = reportDay(timestamp);
    const [counts, samples] = await Promise.all([
      redis.hgetall(`${prefix}${day}:counts`),
      redis.hgetall(`${prefix}${day}:samples`),
    ]);
    const text = reportText(day, counts, samples);
    const recipients = await options.database.transaction(
      { userId: null, role: "system" },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT email FROM identity.user_directory WHERE role='admin' AND NOT banned`,
          )
        ).rows,
    );
    if (!recipients.length) throw new Error("REPORT_NO_ADMINISTRATOR");
    for (const recipient of recipients) {
      const email = z.email().parse(recipient.email);
      const marker = `${prefix}${day}:sent:${createHash("sha256").update(email).digest("hex")}`;
      if (await redis.get(marker)) continue;
      await options.send(email, `OligInvest — raport błędów ${day}`, text);
      await redis.set(marker, "1", "EX", RETENTION);
    }
  };
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/internal/metrics")
      return void response.writeHead(404).end();
    try {
      if (options.database.poolInUse)
        metrics.gauge("db_pool_in_use", { instance: "app" }, options.database.poolInUse());
      for (const [instance, connection] of [
        ["queue", redis],
        ["cache", options.cache],
      ] as const) {
        const info = await connection.info("memory");
        const used = /^used_memory:(\d+)\r?$/m.exec(info)?.[1];
        if (!used) throw new Error("INVALID_MEMORY_METRIC");
        metrics.gauge("valkey_used_memory_bytes", { instance }, Number(used));
      }
      for (const [provider, limit] of [
        ["gpw", 1],
        ["nbp", 6],
        ["ecb", 6],
        ["yahoo", 12],
      ] as const) {
        const used = await redis.get(`quota:${provider}:minute:${Math.floor(Date.now() / 60000)}`);
        metrics.gauge(
          "provider_quota_remaining",
          { provider, window: "minute" },
          Math.max(
            0,
            limit -
              z.coerce
                .number()
                .int()
                .nonnegative()
                .parse(used ?? 0),
          ),
        );
        metrics.gauge(
          "provider_circuit_open",
          { provider },
          (await redis.get(`breaker:${provider}`)) ? 1 : 0,
        );
      }
      const issues = await options.database.transaction(
        { userId: null, role: "system" },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT severity, count(*)::text AS count FROM market.data_quality_issues WHERE status='open' GROUP BY severity`,
            )
          ).rows,
      );
      for (const severity of ["BLOCK", "WARN", "INFO"])
        metrics.gauge("data_quality_issues_open", { severity }, 0);
      for (const row of issues)
        metrics.gauge(
          "data_quality_issues_open",
          { severity: z.enum(["BLOCK", "WARN", "INFO"]).parse(row.severity) },
          z.coerce.number().int().nonnegative().parse(row.count),
        );
      for (const queue of options.queues) {
        const counts = await queue.getJobCounts("waiting", "active", "failed", "delayed");
        for (const [state, count] of Object.entries(counts))
          metrics.gauge("queue_jobs", { queue: queue.name, state }, count);
      }
      response
        .writeHead(200, {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-store",
        })
        .end(metrics.render());
    } catch {
      response.writeHead(503).end();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, resolve);
    });
    await notify.upsertJobScheduler(
      "monitoring.daily-report",
      { pattern: "0 7 * * *", tz: "Europe/Warsaw" },
      {
        name: "monitoring.daily-report",
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 60000 },
          removeOnComplete: { age: RETENTION },
          removeOnFail: { age: RETENTION },
        },
      },
    );
  } catch (error) {
    server.close();
    redis.disconnect();
    throw error;
  }
  return {
    address: server.address(),
    metrics,
    record,
    handle: async (job: Job) => {
      if (job.name === "monitoring.error") await record(job.data);
      else {
        z.object({}).strict().parse(job.data);
        await daily(job.opts.prevMillis ?? job.timestamp);
      }
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      redis.disconnect();
    },
  };
}
