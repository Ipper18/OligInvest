import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import {
  object,
  watchlistDetailResponse,
  watchlistInput,
  watchlistItemInput,
  watchlistItemPatch,
  watchlistItemSchema,
  watchlistPatch,
  watchlistSchema,
} from "../contracts.js";
import { type MarketDependencies, marketError } from "./routes.js";
import { WatchlistRepository } from "./watchlists.js";

const json = <T extends z.ZodType>(schema: T) => ({
  description: "Watchlista.",
  content: { "application/json": { schema } },
});
const base = { tags: ["market"], security: [{ sessionCookie: [] }] };
const params = z.object({ watchlistId: z.uuid() }).strict();
const itemParams = params.extend({ instrumentId: z.uuid() }).strict();
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const hook = (result: { success: boolean }) => {
  if (!result.success) throw new ProblemError("VALIDATION_FAILED");
  return undefined;
};
export function mountWatchlists(api: OpenAPIHono<AppEnv>, dependencies: MarketDependencies) {
  const repository = async () => new WatchlistRepository(await dependencies.repository());
  api.openapi(
    createRoute({
      ...base,
      method: "get",
      path: "/market/watchlists",
      operationId: "listWatchlists",
      responses: { 200: json(object({ data: z.array(watchlistSchema) })), 401: marketError },
    }),
    async (c) =>
      c.json(await (await repository()).list(await dependencies.authorize(c.req.raw)), 200),
  );
  api.openapi(
    createRoute({
      ...base,
      method: "post",
      path: "/market/watchlists",
      operationId: "createWatchlist",
      request: { body: body(watchlistInput) },
      responses: {
        201: json(watchlistSchema),
        401: marketError,
        422: marketError,
        429: {
          ...marketError,
          headers: {
            ...marketError.headers,
            "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
            RateLimit: { schema: { type: "string" as const } },
            "RateLimit-Policy": { schema: { type: "string" as const } },
          },
        },
      },
    }),
    async (c) => {
      const result = await (await repository()).create(
        await dependencies.authorize(c.req.raw),
        c.req.valid("json"),
        c.req.header("Idempotency-Key"),
      );
      if (result.replayed) c.header("Idempotent-Replayed", "true");
      return c.json(result.value, 201);
    },
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "get",
      path: "/market/watchlists/{watchlistId}",
      operationId: "getWatchlist",
      request: { params },
      responses: { 200: json(watchlistDetailResponse), 401: marketError, 404: marketError },
    }),
    async (c) =>
      c.json(
        await (await repository()).detail(
          await dependencies.authorize(c.req.raw),
          c.req.valid("param").watchlistId,
        ),
        200,
      ),
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "patch",
      path: "/market/watchlists/{watchlistId}",
      operationId: "updateWatchlist",
      request: { params, body: body(watchlistPatch) },
      responses: {
        200: json(watchlistSchema),
        401: marketError,
        404: marketError,
        422: marketError,
      },
    }),
    async (c) =>
      c.json(
        await (await repository()).update(
          await dependencies.authorize(c.req.raw),
          c.req.valid("param").watchlistId,
          c.req.valid("json"),
        ),
        200,
      ),
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "delete",
      path: "/market/watchlists/{watchlistId}",
      operationId: "deleteWatchlist",
      request: { params },
      responses: { 204: { description: "Usunięto." }, 401: marketError, 404: marketError },
    }),
    async (c) => {
      await (await repository()).remove(
        await dependencies.authorize(c.req.raw),
        c.req.valid("param").watchlistId,
      );
      return c.body(null, 204);
    },
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "post",
      path: "/market/watchlists/{watchlistId}/items",
      operationId: "addWatchlistItem",
      request: { params, body: body(watchlistItemInput) },
      responses: {
        201: json(watchlistItemSchema),
        401: marketError,
        404: marketError,
        409: {
          ...marketError,
          headers: {
            ...marketError.headers,
            "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
          },
        },
        422: marketError,
      },
    }),
    async (c) => {
      const result = await (await repository()).addItem(
        await dependencies.authorize(c.req.raw),
        c.req.valid("param").watchlistId,
        c.req.valid("json"),
        c.req.header("Idempotency-Key"),
      );
      if (result.replayed) c.header("Idempotent-Replayed", "true");
      return c.json(result.value, 201);
    },
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "patch",
      path: "/market/watchlists/{watchlistId}/items/{instrumentId}",
      operationId: "updateWatchlistItem",
      request: { params: itemParams, body: body(watchlistItemPatch) },
      responses: {
        200: json(watchlistItemSchema),
        401: marketError,
        404: marketError,
        422: marketError,
      },
    }),
    async (c) =>
      c.json(
        await (await repository()).updateItem(
          await dependencies.authorize(c.req.raw),
          c.req.valid("param").watchlistId,
          c.req.valid("param").instrumentId,
          c.req.valid("json"),
        ),
        200,
      ),
    hook,
  );
  api.openapi(
    createRoute({
      ...base,
      method: "delete",
      path: "/market/watchlists/{watchlistId}/items/{instrumentId}",
      operationId: "removeWatchlistItem",
      request: { params: itemParams },
      responses: { 204: { description: "Usunięto." }, 401: marketError, 404: marketError },
    }),
    async (c) => {
      await (await repository()).removeItem(
        await dependencies.authorize(c.req.raw),
        c.req.valid("param").watchlistId,
        c.req.valid("param").instrumentId,
      );
      return c.body(null, 204);
    },
    hook,
  );
}
