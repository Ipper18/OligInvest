import { createLogger } from "@oliginvest/platform";
import { Queue, Worker } from "bullmq";
import { startAlertsWorker } from "../dist/alerts-runtime.js";
import { createAuthMailer } from "../dist/auth-mail.js";
import { jobFeatureFlags } from "../dist/feature-flags.js";
import { reserveMail } from "../dist/mail-quota.js";
import { dispatchNotification } from "../dist/modules.js";
import { startPortfolioWorker } from "../dist/portfolio-runtime.js";
import { readRuntime } from "../dist/runtime.js";

if (process.env.NODE_ENV !== "test" || process.env.DB_NAME !== "oliginvest_dev")
  throw new Error("Isolated browser worker required");
const logger = createLogger();
const runtime = readRuntime(process.env);
const flags = jobFeatureFlags(process.env, runtime.config, logger);
const queues = ["import", "recompute", "alerts", "notify"].map(
  (name) => new Queue(name, { connection: runtime.connection }),
);
const worker = await startPortfolioWorker({
  database: flags.database,
  cache: flags.cache,
  queues,
  connection: runtime.connection,
  logger,
});
const alerts = await startAlertsWorker({
  database: flags.database,
  cache: flags.cache,
  queues,
  connection: runtime.connection,
  logger,
  flags: flags.flags,
  origin: runtime.config.PUBLIC_BASE_URL,
});
const mailer = createAuthMailer(runtime.config, runtime.mode, runtime.mail.port, (security) =>
  reserveMail(async (key) => {
    const client = await queues[0].getBackend().client;
    const n = Number(await client.runCommand("incr", [key]));
    await client.runCommand("expire", [key, "172800"]);
    return n;
  }, security),
);
const { commandTimeout: _deadline, ...blocking } = runtime.connection;
const notify = new Worker(
  "notify",
  (job) => dispatchNotification(flags.database, job.data, mailer.sendNotification),
  { connection: { ...blocking, maxRetriesPerRequest: null } },
);
await notify.waitUntilReady();
process.send?.("ready");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await worker.close();
    await alerts.close();
    await notify.close();
    mailer.close();
    await Promise.all(queues.map((queue) => queue.close()));
    flags.cache.disconnect();
    await flags.close();
    process.exitCode = 0;
  });
