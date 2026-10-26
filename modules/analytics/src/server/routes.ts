import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { DatabaseContext } from "@oliginvest/db";
import { marketError } from "@oliginvest/mod-market/server";
import { type AppEnv, ProblemError, requirePermission } from "@oliginvest/platform";
import { bodyLimit } from "hono/body-limit";
import {
  analyticsLimits,
  analyticsRun,
  analyticsRunInput,
  analyticsRunPage,
  analyticsRunStatus,
  analyticsRunType,
} from "../contracts.js";
import { type AnalyticsRepository, HEAVY_TYPES } from "./runs.js";

export interface AnalyticsDependencies {
  repository(): AnalyticsRepository | Promise<AnalyticsRepository>;
  authorize(request: Request): Promise<DatabaseContext>;
  assertOrigin(request: Request): void | Promise<void>;
}
const security = [{ sessionCookie: [] }];
const json = (schema: z.ZodType, description = "Analiza.") => ({
  description,
  content: { "application/json": { schema } },
});
const retryAfter = { "Retry-After": { schema: { type: "integer" as const, minimum: 1 } } };
const conflict = { ...marketError, headers: { ...marketError.headers, ...retryAfter } };
const rateLimited = {
  ...marketError,
  headers: {
    ...marketError.headers,
    ...retryAfter,
    RateLimit: { schema: { type: "string" as const } },
    "RateLimit-Policy": { schema: { type: "string" as const } },
  },
};
const location = { Location: { schema: { type: "string" as const, format: "uri-reference" } } };
const runParams = z.object({ runId: z.uuid() }).strict();
const listQuery = z
  .object({
    type: z
      .array(analyticsRunType)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
    status: z
      .array(analyticsRunStatus)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(512).optional(),
  })
  .strict();
const idempotencyKey = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .openapi("IdempotencyKeyValue");
type Owner = { userId: string; role: "user" | "pro" | "admin" };

function owner(context: DatabaseContext): Owner {
  if (!context.userId || !["user", "pro", "admin"].includes(context.role))
    throw new ProblemError("FORBIDDEN");
  return context as Owner;
}
function listValues(url: string) {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (key === "type" || key === "status")
      values[key] = [...((values[key] as string[]) ?? []), value];
    else {
      if (key in values) throw new ProblemError("VALIDATION_FAILED");
      values[key] = value;
    }
  }
  return values;
}
const invalid = (error: unknown): never => {
  if (error instanceof z.ZodError) throw new ProblemError("VALIDATION_FAILED");
  throw error;
};

/** FR-04.01, BL-312: runs, limits and cancellation; module flag checked by the api host. */
export function mountAnalytics(api: OpenAPIHono<AppEnv>, deps: AnalyticsDependencies) {
  api.use("/analytics/*", async (c, next) => {
    const principal = owner(await deps.authorize(c.req.raw));
    if (c.req.method !== "GET") await deps.assertOrigin(c.req.raw);
    requirePermission(principal.role, "analytics:run:light");
    await next();
  });
  api.use(
    "/analytics/*",
    bodyLimit({
      maxSize: 65_536,
      onError: () => {
        throw new ProblemError("BAD_REQUEST");
      },
    }),
  );
  const routes = {
    list: createRoute({
      method: "get",
      path: "/analytics/runs",
      operationId: "listAnalyticsRuns",
      tags: ["analytics"],
      security,
      request: { query: listQuery },
      responses: {
        200: json(analyticsRunPage, "Analizy (bez pełnych wyników)."),
        401: marketError,
        404: marketError,
      },
    }),
    create: createRoute({
      method: "post",
      path: "/analytics/runs",
      operationId: "createAnalyticsRun",
      tags: ["analytics"],
      security,
      request: {
        headers: z.object({ "Idempotency-Key": idempotencyKey }),
        body: { required: true, content: { "application/json": { schema: analyticsRunInput } } },
      },
      responses: {
        201: { ...json(analyticsRun), headers: location },
        202: { ...json(analyticsRun), headers: location },
        401: marketError,
        403: marketError,
        404: marketError,
        409: conflict,
        412: marketError,
        422: marketError,
        429: rateLimited,
      },
    }),
    get: createRoute({
      method: "get",
      path: "/analytics/runs/{runId}",
      operationId: "getAnalyticsRun",
      tags: ["analytics"],
      security,
      request: { params: runParams },
      responses: { 200: json(analyticsRun), 401: marketError, 404: marketError },
    }),
    delete: createRoute({
      method: "delete",
      path: "/analytics/runs/{runId}",
      operationId: "deleteAnalyticsRun",
      tags: ["analytics"],
      security,
      request: { params: runParams },
      responses: { 204: { description: "Usunięto." }, 401: marketError, 404: marketError },
    }),
    cancel: createRoute({
      method: "post",
      path: "/analytics/runs/{runId}/cancel",
      operationId: "cancelAnalyticsRun",
      tags: ["analytics"],
      security,
      request: { params: runParams },
      responses: {
        202: json(analyticsRun),
        401: marketError,
        404: marketError,
        409: conflict,
      },
    }),
    limits: createRoute({
      method: "get",
      path: "/analytics/limits",
      operationId: "getAnalyticsLimits",
      tags: ["analytics"],
      security,
      responses: { 200: json(analyticsLimits, "Limity."), 401: marketError, 404: marketError },
    }),
  };
  for (const route of Object.values(routes)) api.openAPIRegistry.registerPath(route);
  const honoPath = (path: string) => path.replace(/\{(\w+)\}/gu, ":$1");
  const principalOf = async (request: Request) => owner(await deps.authorize(request));
  api.get(routes.list.path, async (c) => {
    const query = (() => {
      try {
        return listQuery.parse(listValues(c.req.url));
      } catch (error) {
        return invalid(error);
      }
    })();
    const data = await (await deps.repository()).list(await principalOf(c.req.raw), query);
    return c.json(analyticsRunPage.parse(data), 200);
  });
  api.post(routes.create.path, async (c) => {
    const principal = await principalOf(c.req.raw);
    const key = idempotencyKey.safeParse(c.req.header("Idempotency-Key"));
    if (!key.success) throw new ProblemError("VALIDATION_FAILED");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ProblemError("BAD_REQUEST");
    }
    const parsed = analyticsRunInput.safeParse(raw);
    if (!parsed.success) {
      // Numeric bounds of Z-19 have their own code; other shape errors are plain validation.
      const bounds = parsed.error.issues.some(
        (i) => i.code === "too_big" || i.code === "too_small",
      );
      throw new ProblemError(bounds ? "PARAMETERS_OUT_OF_BOUNDS" : "VALIDATION_FAILED");
    }
    if (HEAVY_TYPES.has(parsed.data.type)) requirePermission(principal.role, "analytics:run:heavy");
    const run = await (await deps.repository()).create(principal, parsed.data, key.data);
    c.header("Location", `/api/v1/analytics/runs/${run.id}`);
    return c.json(analyticsRun.parse(run), run.status === "done" ? 201 : 202);
  });
  api.get(honoPath(routes.get.path), async (c) => {
    const parsed = runParams.safeParse({ runId: c.req.param("runId") });
    if (!parsed.success) throw new ProblemError("NOT_FOUND");
    const run = await (await deps.repository()).get(
      await principalOf(c.req.raw),
      parsed.data.runId,
    );
    return c.json(analyticsRun.parse(run), 200);
  });
  api.delete(honoPath(routes.delete.path), async (c) => {
    const parsed = runParams.safeParse({ runId: c.req.param("runId") });
    if (!parsed.success) throw new ProblemError("NOT_FOUND");
    await (await deps.repository()).delete(await principalOf(c.req.raw), parsed.data.runId);
    return c.body(null, 204);
  });
  api.post(honoPath(routes.cancel.path), async (c) => {
    const parsed = runParams.safeParse({ runId: c.req.param("runId") });
    if (!parsed.success) throw new ProblemError("NOT_FOUND");
    const run = await (await deps.repository()).cancel(
      await principalOf(c.req.raw),
      parsed.data.runId,
    );
    return c.json(analyticsRun.parse(run), 202);
  });
  api.get(routes.limits.path, async (c) => {
    const data = await (await deps.repository()).limits(await principalOf(c.req.raw));
    return c.json(analyticsLimits.parse(data), 200);
  });
}
