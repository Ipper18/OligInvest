import { createHash } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { DatabaseContext } from "@oliginvest/db";
import { type AppEnv, PROBLEM_DEFINITIONS, ProblemError } from "@oliginvest/platform";
import {
  apiQuoteSchema,
  chartSchema,
  fxResponseSchema,
  instrumentResponseSchema,
  instrumentType,
  object,
  pageSchema,
  statusSchema,
  summarySchema,
} from "../contracts.js";
import type { MarketRepository } from "./repository.js";

export interface MarketDependencies {
  repository(): MarketRepository | Promise<MarketRepository>;
  authorize(request: Request): Promise<DatabaseContext>;
  searchInBackground(query: string): Promise<void>;
}
export const problemSchema = object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.enum(
    Object.keys(PROBLEM_DEFINITIONS) as [
      keyof typeof PROBLEM_DEFINITIONS,
      ...Array<keyof typeof PROBLEM_DEFINITIONS>,
    ],
  ),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
  candidates: z.array(summarySchema).optional(),
  existingImportId: z.uuid().optional(),
}).openapi("Problem");
export const marketError = {
  description: "Błąd żądania.",
  headers: { "X-Request-Id": { schema: { type: "string" as const, maxLength: 64 } } },
  content: { "application/problem+json": { schema: problemSchema } },
};
const json = <T extends z.ZodType>(schema: T) => ({
  description: "Dane rynkowe.",
  content: { "application/json": { schema } },
});
const uuid = z.uuid();
const params = z.object({ instrumentId: uuid }).strict();
const date = z.string().date();
const searchQuery = z
  .object({
    q: z.string().min(1).max(64),
    type: z
      .array(instrumentType)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
    mic: z
      .string()
      .regex(/^[A-Z0-9]{4}$/)
      .optional(),
    includeInactive: z
      .enum(["true", "false"])
      .transform((s) => s === "true")
      .optional()
      .openapi({ type: "boolean", default: false }),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(512).optional(),
  })
  .strict();
const chartQuery = z
  .object({
    interval: z.enum(["15m", "1h", "1d", "1w", "1mo"]).default("1d"),
    from: date.optional(),
    to: date.optional(),
    adjusted: z
      .enum(["true", "false"])
      .transform((s) => s === "true")
      .optional()
      .openapi({ type: "boolean", default: true }),
    maxPoints: z.coerce.number().int().min(50).max(3000).default(1500),
  })
  .strict();
const noCache = { description: "Treść bez zmian." };
const etagHeaders = { ETag: { schema: { type: "string" as const } } };
const security = [{ sessionCookie: [] }];
export function mountMarket(api: OpenAPIHono<AppEnv>, dependencies: MarketDependencies) {
  // Authenticate before query validation and before conditional responses (no public 304s).
  api.use("/market/*", async (context, next) => {
    await dependencies.authorize(context.req.raw);
    await next();
  });
  const hook = (result: { success: boolean }) => {
    if (!result.success) throw new ProblemError("VALIDATION_FAILED");
    return undefined;
  };
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/instruments",
      operationId: "searchInstruments",
      tags: ["market"],
      security,
      request: { query: searchQuery },
      responses: { 200: json(pageSchema), 401: marketError, 403: marketError, 422: marketError },
    }),
    async (context) => {
      const query = context.req.valid("query");
      const principal = await dependencies.authorize(context.req.raw);
      const data = await (await dependencies.repository()).search(principal, {
        ...query,
        includeInactive: query.includeInactive ?? false,
      });
      // Enqueueing is bounded by the queue client deadline; a queue outage does not hide known data.
      void dependencies.searchInBackground(query.q).catch(() => {});
      return context.json(data, 200);
    },
    hook,
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/instruments/{instrumentId}",
      operationId: "getInstrument",
      tags: ["market"],
      security,
      request: { params },
      responses: {
        200: { ...json(instrumentResponseSchema), headers: etagHeaders },
        304: noCache,
        401: marketError,
        404: marketError,
      },
    }),
    async (context) => {
      const data = await (await dependencies.repository()).instrument(
        await dependencies.authorize(context.req.raw),
        context.req.valid("param").instrumentId,
      );
      const tag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
      context.header("ETag", tag);
      context.header("Cache-Control", "private, max-age=300");
      if (context.req.header("If-None-Match") === tag) return context.body(null, 304);
      return context.json(data, 200);
    },
    hook,
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/instruments/{instrumentId}/chart",
      operationId: "getInstrumentChart",
      tags: ["market"],
      security,
      request: { params, query: chartQuery },
      responses: {
        200: {
          ...json(chartSchema),
          headers: { ...etagHeaders, "Cache-Control": { schema: { type: "string" as const } } },
        },
        304: noCache,
        401: marketError,
        404: marketError,
        422: marketError,
      },
    }),
    async (context) => {
      const query = context.req.valid("query");
      const data = await (await dependencies.repository()).chart(
        await dependencies.authorize(context.req.raw),
        context.req.valid("param").instrumentId,
        { ...query, adjusted: query.adjusted ?? true },
      );
      const tag = `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
      context.header("ETag", tag);
      context.header("Cache-Control", "private, max-age=300");
      if (context.req.header("If-None-Match") === tag) return context.body(null, 304);
      return context.json(data, 200);
    },
    hook,
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/quotes",
      operationId: "getQuotes",
      tags: ["market"],
      security,
      request: {
        query: z
          .object({
            instrumentId: z
              .array(uuid)
              .min(1)
              .max(100)
              .openapi({ param: { style: "form", explode: true } }),
          })
          .strict(),
      },
      responses: {
        200: json(object({ data: z.array(apiQuoteSchema) })),
        401: marketError,
        422: marketError,
      },
    }),
    async (context) => {
      const quotes = await (await dependencies.repository()).quotes(
        await dependencies.authorize(context.req.raw),
        context.req.valid("query").instrumentId,
      );
      return context.json(
        { data: quotes.map(({ fetchedAt: _f, ...quote }) => apiQuoteSchema.parse(quote)) },
        200,
      );
    },
    hook,
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/status",
      operationId: "getMarketDataStatus",
      tags: ["market"],
      security,
      responses: { 200: json(statusSchema), 401: marketError },
    }),
    async (context) =>
      context.json(
        await (await dependencies.repository()).status(
          await dependencies.authorize(context.req.raw),
        ),
        200,
      ),
  );
  api.openapi(
    createRoute({
      method: "get",
      path: "/market/fx/rates",
      operationId: "getFxRates",
      tags: ["market"],
      security,
      request: {
        query: z
          .object({
            currency: z
              .array(z.string().regex(/^[A-Z]{3}$/))
              .min(1)
              .max(10)
              .openapi({ param: { style: "form", explode: true } }),
            from: date.optional(),
            to: date.optional(),
          })
          .strict(),
      },
      responses: { 200: json(fxResponseSchema), 401: marketError, 422: marketError },
    }),
    async (context) => {
      const query = context.req.valid("query");
      return context.json(
        await (await dependencies.repository()).fx(
          await dependencies.authorize(context.req.raw),
          query.currency,
          query.from,
          query.to,
        ),
        200,
      );
    },
    hook,
  );
}
