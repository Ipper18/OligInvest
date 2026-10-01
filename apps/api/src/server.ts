import { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createLogger } from "@oliginvest/platform";
import { createRuntime } from "./runtime.js";

const logger = createLogger();
try {
  const { app, hostname, port } = createRuntime(process.env, logger);
  const server = serve({ fetch: app.fetch, hostname, port });
  server.on("error", () => {
    logger.error({ event: "api.server.failed", code: "INTERNAL" });
    process.exitCode = 1;
  });
  const shutdown = () => {
    const deadline = setTimeout(() => {
      if (server instanceof Server) server.closeAllConnections();
    }, 5000);
    deadline.unref();
    server.close(() => clearTimeout(deadline));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  logger.error({ event: "api.start.failed", code: "INTERNAL" });
  process.exitCode = 1;
}
