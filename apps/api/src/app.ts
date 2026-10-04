import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type AppEnv,
  type PlatformLogger,
  ProblemError,
  withRequestContext,
} from "@oliginvest/platform";
import { bodyLimit } from "hono/body-limit";
import { type IdentityDependencies, mountIdentity } from "./auth/identity-routes.js";
import { type AuthRouteDependencies, createAuthRouter, mountStepUp } from "./auth/routes.js";

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
    auth?: AuthRouteDependencies & Partial<Pick<IdentityDependencies, "administration">>;
  }>,
) {
  const app = new OpenAPIHono<AppEnv>();
  type HealthResult = z.infer<typeof healthSchema>;
  let cached: { result: HealthResult; expiresAt: number } | undefined;
  let inFlight: Promise<HealthResult> | undefined;
  function readiness(): Promise<HealthResult> {
    if (cached && performance.now() < cached.expiresAt) return Promise.resolve(cached.result);
    if (inFlight) return inFlight;
    inFlight = Promise.all(
      Object.entries(options.checks).map(async ([name, check]) => {
        try {
          await check();
          return [name, "ok"] as const;
        } catch {
          return [name, "fail"] as const;
        }
      }),
    )
      .then((entries) => {
        const result = healthSchema.parse({
          status: entries.every(([, value]) => value === "ok") ? "ok" : "fail",
          checks: Object.fromEntries(entries),
        });
        cached = { result, expiresAt: performance.now() + 3000 };
        return result;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }
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

  const authDependencies = options.auth ?? {
    service: () => {
      throw new ProblemError("SERVICE_UNAVAILABLE");
    },
    clientIp: () => "unknown",
  };
  app.use(
    "/api/auth/*",
    bodyLimit({
      maxSize: 16_384,
      onError: () => {
        throw new ProblemError("BAD_REQUEST");
      },
    }),
  );
  app.use(
    "/api/v1/me/*",
    bodyLimit({
      maxSize: 16_384,
      onError: () => {
        throw new ProblemError("BAD_REQUEST");
      },
    }),
  );
  const auth = createAuthRouter(authDependencies);
  app.route("/api/auth", auth);
  app.all("/api/auth/*", () => {
    throw new ProblemError("FORBIDDEN");
  });
  const api = new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw new ProblemError("BAD_REQUEST");
    },
  });
  api.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "__Host-oliginvest.session_token",
  });
  mountStepUp(api, authDependencies);
  mountIdentity(api, {
    ...authDependencies,
    administration:
      options.auth?.administration ??
      (() => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      }),
  });
  function document() {
    const metadata = {
      openapi: "3.1.0",
      info: { title: "OligInvest API", version: "1.0.0-draft.1" },
    };
    const result = api.getOpenAPI31Document({ ...metadata, servers: [{ url: "/api/v1" }] });
    const authDocument = auth.getOpenAPI31Document(metadata);
    return {
      ...result,
      paths: {
        ...result.paths,
        ...Object.fromEntries(
          Object.entries(authDocument.paths ?? {}).map(([path, operation]) => [
            path,
            { ...operation, servers: [{ url: "/api/auth" }] },
          ]),
        ),
      },
      components: {
        ...result.components,
        schemas: { ...result.components?.schemas, ...authDocument.components?.schemas },
      },
    };
  }
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
      const result = await readiness();
      if (result.status === "fail") context.header("Retry-After", "1");
      return context.json(result, result.status === "ok" ? 200 : 503);
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
    (context) => context.json(documentSchema.parse(document())),
  );
  app.route("/api/v1", api);
  return app;
}
