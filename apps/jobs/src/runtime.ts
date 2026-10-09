import { loadConfig } from "@oliginvest/config";
import { createLogger, type PlatformLogger } from "@oliginvest/platform";
import { Queue, Worker } from "bullmq";
import { z } from "zod";
import type { createAuthMailer } from "./auth-mail.js";
import { createQueueRegistry } from "./registry.js";

const settingsSchema = z
  .object({
    VALKEY_QUEUE_HOST: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]_-]+$/u),
    VALKEY_QUEUE_PORT: z.coerce.number().int().min(1).max(65535),
    VALKEY_QUEUE_USER: z.string().min(1),
    JOBS_INSTANCE_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  })
  .strict();

export function readRuntime(env: Readonly<Record<string, string | undefined>>) {
  const mode = z.enum(["development", "test", "production"]).parse(env.NODE_ENV);
  const config = loadConfig("jobs", env, { mode });
  const settings = settingsSchema.parse(
    Object.fromEntries(Object.keys(settingsSchema.shape).map((key) => [key, env[key]])),
  );
  return {
    mode,
    config,
    mail: config.SMTP_HOST
      ? {
          config,
          port: z.coerce
            .number()
            .int()
            .min(1)
            .max(65535)
            .parse(env.SMTP_PORT ?? "587"),
        }
      : undefined,
    heartbeatKey: `health:jobs:${settings.JOBS_INSTANCE_ID}`,
    connection: {
      host: settings.VALKEY_QUEUE_HOST,
      port: settings.VALKEY_QUEUE_PORT,
      username: settings.VALKEY_QUEUE_USER,
      password: config.VALKEY_QUEUE_JOBS_PASSWORD,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    },
  };
}

type Runtime = ReturnType<typeof readRuntime>;
function openQueue(name: string, runtime: Runtime, logger: PlatformLogger) {
  const queue = new Queue(name, { connection: runtime.connection });
  queue.on("error", () => logger.error({ event: "jobs.connection_failed" }));
  return queue;
}

export async function startJobs(
  env: Readonly<Record<string, string | undefined>>,
  logger: PlatformLogger = createLogger(),
) {
  const runtime = readRuntime(env);
  const { jobFeatureFlags } = await import("./feature-flags.js");
  const flagRuntime = jobFeatureFlags(env, runtime.config, logger);
  const { registry, queues: definitions } = createQueueRegistry((key, subject) =>
    flagRuntime.flags.enabled(key, subject),
  );
  const queues = definitions.map(({ name }) => openQueue(name, runtime, logger));
  let mailer: ReturnType<typeof createAuthMailer> | undefined;
  let mailWorker: Worker | undefined;
  let marketWorker: { close(): Promise<void> } | undefined;
  let portfolioWorker: { close(): Promise<void> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let heartbeat: Promise<void> = Promise.resolve();
  const healthQueue = queues[0];
  if (!healthQueue) throw new Error("Missing queue catalog");
  const pulse = async () => {
    const client = await healthQueue.getBackend().client;
    await client.set(runtime.heartbeatKey, String(Date.now()), { PX: 10000 });
  };
  const tick = () => {
    heartbeat = pulse()
      .catch(() => {
        logger.error({ event: "jobs.heartbeat_failed" });
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 1000);
      });
  };
  const close = async () => {
    stopped = true;
    clearTimeout(timer);
    await heartbeat;
    try {
      await (await healthQueue.getBackend().client).del(runtime.heartbeatKey);
    } catch {
      logger.warn({ event: "jobs.heartbeat_cleanup_failed" });
    } finally {
      await mailWorker?.close();
      await portfolioWorker?.close();
      await marketWorker?.close();
      mailer?.close();
      await flagRuntime.close();
      await Promise.allSettled(queues.map((queue) => queue.close()));
    }
  };
  try {
    await Promise.all(queues.map((queue) => queue.waitUntilReady()));
    const { startPortfolioWorker } = await import("./portfolio-runtime.js");
    portfolioWorker = await startPortfolioWorker({
      database: flagRuntime.database,
      cache: flagRuntime.cache,
      queues,
      connection: runtime.connection,
      logger,
    });
    const { startMarketWorker } = await import("./market-runtime.js");
    marketWorker = await startMarketWorker({
      database: flagRuntime.database,
      cache: flagRuntime.cache,
      queue: healthQueue,
      connection: runtime.connection,
      logger,
    });
    if (runtime.mail) {
      const { createAuthMailer } = await import("./auth-mail.js");
      mailer = createAuthMailer(runtime.mail.config, runtime.mode, runtime.mail.port);
      // The worker uses blocking reads; the producer's 1.5 s command deadline
      // would time them out while the queue is idle.
      const { commandTimeout: _producerTimeout, ...workerConnection } = runtime.connection;
      mailWorker = new Worker(
        "notify",
        async (job) => {
          try {
            await mailer?.send(job.name, job.data);
          } catch {
            logger.warn({ event: "auth.mail_delivery_failed" });
            throw new Error("AUTH_MAIL_DELIVERY_FAILED");
          }
        },
        { connection: { ...workerConnection, maxRetriesPerRequest: null }, concurrency: 1 },
      );
      mailWorker.on("error", () => logger.error({ event: "jobs.mail_connection_failed" }));
      await mailWorker.waitUntilReady();
    }
    await pulse();
    timer = setTimeout(tick, 1000);
    logger.info({ event: "jobs.ready" });
    return { registry, queues, close };
  } catch (error) {
    await portfolioWorker?.close();
    await mailWorker?.close();
    await marketWorker?.close();
    flagRuntime.cache.disconnect();
    mailer?.close();
    await flagRuntime.close();
    await Promise.allSettled(queues.map((queue) => queue.close()));
    throw error;
  }
}

export async function checkHealth(env: Readonly<Record<string, string | undefined>>) {
  const runtime = readRuntime(env);
  const queue = openQueue("ingest", runtime, createLogger());
  try {
    const client = await queue.getBackend().client;
    if ((await client.runCommand("ping", [])) !== "PONG") return false;
    const heartbeat = await client.get(runtime.heartbeatKey);
    if (!heartbeat || !/^\d+$/u.test(heartbeat)) return false;
    const age = Date.now() - Number(heartbeat);
    return age >= 0 && age <= 10000;
  } catch {
    return false;
  } finally {
    await queue.close();
  }
}
