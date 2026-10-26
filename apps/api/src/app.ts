import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import {
  type AppEnv,
  Metrics,
  type PlatformLogger,
  ProblemError,
  withRequestContext,
} from "@oliginvest/platform";
import { bodyLimit } from "hono/body-limit";
import { type IdentityDependencies, mountIdentity } from "./auth/identity-routes.js";
import { mountPreferences } from "./auth/preferences-routes.js";
import { type AuthRouteDependencies, createAuthRouter, mountStepUp } from "./auth/routes.js";
import { SESSION_COOKIE } from "./auth/session.js";
import {
  type AnalyticsDependencies,
  analyticsModule,
  type MarketDependencies,
  mountEducation,
  mountMarket,
  mountPortfolio,
  type PortfolioDependencies,
} from "./modules.js";
import { mountStream, type StreamDependencies } from "./stream-routes.js";
import { mountNotifications } from "./notification-routes.js";
import {mountAlerts} from "./alert-routes.js";
import {mountPats} from "./auth/pat-routes.js";
import {mountQuick} from './quick-routes.js';

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
    market?: MarketDependencies;
    portfolio?: PortfolioDependencies;
    analytics?: AnalyticsDependencies;
    education?: {
      database(): AppDatabase | Promise<AppDatabase>;
      authorize(request: Request): Promise<DatabaseContext>;
      assertOrigin(request: Request): void | Promise<void>;
    };
    stream?: StreamDependencies;
    recordError?: (input: unknown) => Promise<void>;
  }>,
) {
  const app = new OpenAPIHono<AppEnv>();
  const metrics = new Metrics();
  app.get("/internal/metrics", (context) =>
    context.text(metrics.render(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );
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
    const started = performance.now();
    const response = await withRequestContext(
      context.req.raw,
      {
        logger: options.logger,
        publicBaseUrl: options.publicBaseUrl,
        route: "/api/*",
      },
      async (requestContext) => {
        context.set("requestContext", requestContext);
        const renewal =
          options.auth && context.req.header("cookie")?.includes(`${SESSION_COOKIE}=`)
            ? await (await options.auth.service()).renewSession(context.req.raw)
            : null;
        await next();
        if (
          renewal &&
          context.res.status < 400 &&
          !context.res.headers
            .getSetCookie()
            .some((value) => value.startsWith(`${SESSION_COOKIE}=`))
        )
          context.res.headers.append("Set-Cookie", renewal);
        return context.res;
      },
    );
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "no-store");
    context.res = response;
    const route = context.req.routePath === "*" ? "/unmatched" : context.req.routePath;
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      context.req.method,
    )
      ? context.req.method
      : "OTHER";
    metrics.add("http_requests_total", { route, method, status: String(response.status) });
    metrics.duration(
      "http_request_duration_seconds",
      { route, method },
      (performance.now() - started) / 1000,
    );
    if (response.status === 429) metrics.add("rate_limit_rejections_total", { group: route });
    if (route.startsWith("/api/auth/"))
      metrics.add("auth_events_total", {
        type: route,
        result: response.status < 400 ? "ok" : "fail",
      });
    if (response.status >= 500 && options.recordError) {
      const body = response.headers.get("Content-Type")?.includes("application/problem+json")
        ? ((await response.clone().json()) as { code?: string })
        : {};
      void options
        .recordError({
          source: "api",
          operation: route,
          code: body.code && /^[A-Z_]{1,80}$/.test(body.code) ? body.code : "HTTP_SERVER_ERROR",
          occurredAt: new Date().toISOString(),
          requestId: response.headers.get("X-Request-Id"),
        })
        .catch(() => {
          metrics.add("monitoring_record_failures_total");
          options.logger.error({ event: "monitoring.record_failed", code: "INTERNAL" });
        });
    }
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
  for(const prefix of ['/api/v1/alerts/*','/api/v1/notifications/*','/api/v1/quick/*'])app.use(prefix,bodyLimit({maxSize:16_384,onError:()=>{throw new ProblemError('BAD_REQUEST');}}));
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
  api.use("*", async (context, next) => {
    const module = /^\/api\/v1\/(analytics|alerts|education)(?:\/|$)/u.exec(
      context.req.path,
    )?.[1];
    if (module) {
      const service = await authDependencies.service();
      const principal = await service.requireData(context.req.raw);
      if (
        !(await service.features.enabled(
          `module.${module === "quick" ? "quick-actions" : module}`,
          { userId: principal.user_id, role: principal.role },
        ))
      )
        throw new ProblemError("NOT_FOUND");
    }
    await next();
  });
  mountIdentity(api, {
    ...authDependencies,
    administration:
      options.auth?.administration ??
      (() => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      }),
  });
  mountPreferences(api, authDependencies);
  mountNotifications(api, authDependencies);
  mountAlerts(api,authDependencies);
  mountPats(api,authDependencies);
  mountQuick(api,authDependencies,options.portfolio);
  mountEducation(
    api,
    options.education ?? {
      database: () => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      },
      authorize: async (request: Request) => {
        const principal = await (await authDependencies.service()).requireData(request);
        return { userId: principal.user_id, role: principal.role };
      },
      assertOrigin: async (request: Request) =>
        (await authDependencies.service()).assertOrigin(request),
    },
  );
  mountMarket(
    api,
    options.market ?? {
      assertOrigin: async (request) => (await authDependencies.service()).assertOrigin(request),
      authorize: async (request) => {
        const principal = await (await authDependencies.service()).requireData(request);
        return { userId: principal.user_id, role: principal.role };
      },
      repository: () => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      },
      searchInBackground: async () => {},
    },
  );
  mountPortfolio(
    api,
    options.portfolio ?? {
      authorize: async (request, stepUp) => {
        const principal = await (await authDependencies.service()).requireData(request, stepUp);
        return { userId: principal.user_id, role: principal.role };
      },
      assertOrigin: async (request) => (await authDependencies.service()).assertOrigin(request),
      repository: () => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      },
    },
  );
  // Optional functional module: mounted only when the package is part of the build.
  const analyticsDependencies: AnalyticsDependencies = options.analytics ?? {
    authorize: async (request: Request) => {
      const principal = await (await authDependencies.service()).requireData(request);
      return { userId: principal.user_id, role: principal.role };
    },
    assertOrigin: async (request: Request) =>
      (await authDependencies.service()).assertOrigin(request),
    repository: () => {
      throw new ProblemError("SERVICE_UNAVAILABLE");
    },
  };
  analyticsModule?.mountAnalytics(api, analyticsDependencies);
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
  mountStream(
    api,
    options.stream ?? {
      origin: options.publicBaseUrl,
      authorize: async () => {
        throw new ProblemError("UNAUTHENTICATED");
      },
      store: async () => {
        throw new ProblemError("SERVICE_UNAVAILABLE");
      },
      ownedInstruments: async () => [],
    },
    metrics,
  );
  app.route("/api/v1", api);
  return app;
}
