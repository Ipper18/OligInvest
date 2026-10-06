import { createLogger } from "@oliginvest/platform";
import { startJobs } from "./runtime.js";
import { startupFailure } from "./startup-failure.js";

const logger = createLogger();
try {
  const runtime = await startJobs(process.env, logger);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    void runtime.close().then(
      () => {
        clearTimeout(deadline);
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("disconnect", shutdown);
} catch (error) {
  logger.error(startupFailure(error));
  process.exitCode = 1;
}
