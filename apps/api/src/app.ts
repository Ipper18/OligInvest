import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type AppEnv,
  type PlatformLogger,
  ProblemError,
  withRequestContext,
} from "@oliginvest/platform";

export type HealthChecks = Readonly<
  Record<"postgres" | "valkeyQueue" | "valkeyCache", () => Promise<void>>
>;
const statusSchema = z.enum(["ok", "fail"]);
const documentSchema = z.record(z.string(), z.unknown());
const healthSchema = z
  .object({
    status: statusSchema,
    checks: z.record(z.string(), statusSchema).optional(),
  })
  .strict()
  .openapi("HealthStatus");
const healthResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: healthSchema } },
});

export function createApp(
  options: Readonly<{
    checks: HealthChecks;
    logger: PlatformLogger;
    publicBaseUrl: string;
  }>,
) {
  const app = new OpenAPIHono<AppEnv>();
  app.use("*", async (context, next) => {
    const response = await withRequestContext(
      context.req.raw,
      {
        logger: options.logger,
        publicBaseUrl: options.publicBaseUrl,
        route: "/api/*",
      },
      async (requestContext) => {
        context.set("requestContext", requestContext);
        await next();
        return context.res;
      },
    );
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("Cache-Control", "no-store");
    context.res = response;
    return response;
  });
  // Let the platform boundary catch Hono errors inside its AsyncLocalStorage scope.
  app.onError((error) => {
    throw error;
  });
  app.notFound(() => {
    throw new ProblemError("NOT_FOUND");
  });

  const api = new OpenAPIHono<AppEnv>();
  api.openapi(
    createRoute({
      method: "get",
      path: "/health/live",
      operationId: "getHealthLive",
      summary: "Sonda żywotności procesu api",
      tags: ["health"],
      security: [],
      responses: { 200: healthResponse("Proces działa.") },
    }),
    (context) => context.json({ status: "ok" as const }, 200),
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/health/ready",
      operationId: "getHealthReady",
      summary: "Sonda gotowości (PostgreSQL, valkey-queue, valkey-cache)",
      tags: ["health"],
      security: [],
      responses: {
        200: healthResponse("Gotowy do obsługi ruchu."),
        503: healthResponse("Co najmniej jedna zależność niedostępna."),
      },
    }),
    async (context) => {
      const entries = await Promise.all(
        Object.entries(options.checks).map(async ([name, check]) => {
          try {
            await check();
            return [name, "ok"] as const;
          } catch {
            return [name, "fail"] as const;
          }
        }),
      );
      const checks = Object.fromEntries(entries);
      const status = entries.every(([, result]) => result === "ok") ? "ok" : "fail";
      if (status === "fail") context.header("Retry-After", "1");
      return context.json(healthSchema.parse({ status, checks }), status === "ok" ? 200 : 503);
    },
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/openapi.json",
      operationId: "getOpenApiDocument",
      summary: "Specyfikacja OpenAPI generowana z Zod",
      tags: ["platform"],
      security: [],
      responses: {
        200: {
          description: "Dokument OpenAPI 3.1.",
          content: { "application/json": { schema: documentSchema } },
        },
      },
    }),
    (context) =>
      context.json(
        documentSchema.parse(
          api.getOpenAPI31Document({
            openapi: "3.1.0",
            info: { title: "OligInvest API", version: "1.0.0-draft.1" },
            servers: [{ url: "/api/v1" }],
          }),
        ),
      ),
  );
  app.route("/api/v1", api);
  return app;
}
