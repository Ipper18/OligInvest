import { createLogger } from "@oliginvest/platform";
import { Queue } from "bullmq";
import { jobFeatureFlags } from "../dist/feature-flags.js";
import { startPortfolioWorker } from "../dist/portfolio-runtime.js";
import { readRuntime } from "../dist/runtime.js";

if (process.env.NODE_ENV !== "test" || process.env.DB_NAME !== "oliginvest_dev")
  throw new Error("Isolated browser worker required");
const logger = createLogger();
const runtime = readRuntime(process.env);
const flags = jobFeatureFlags(process.env, runtime.config, logger);
const queues = ["import", "recompute"].map(
  (name) => new Queue(name, { connection: runtime.connection }),
);
const worker = await startPortfolioWorker({
  database: flags.database,
  cache: flags.cache,
  queues,
  connection: runtime.connection,
  logger,
});
process.send?.("ready");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await worker.close();
    await Promise.all(queues.map((queue) => queue.close()));
    flags.cache.disconnect();
    await flags.close();
    process.exitCode = 0;
  });
