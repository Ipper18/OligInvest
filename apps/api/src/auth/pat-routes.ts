import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { marketError } from "../modules.js";
import { conflictError, rateLimitedError } from "../rate-limited-response.js";
import { patCreate, patCreated, patSchema } from "./pat-contracts.js";
import { PatService } from "./pat-service.js";
import type { AuthRouteDependencies } from "./routes.js";

const json = (schema: z.ZodType) => ({
  description: "Tokeny użytkownika.",
  content: { "application/json": { schema } },
});
export function mountPats(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  const security = [{ sessionCookie: [] }];
  api.openapi(
    createRoute({
      method: "get",
      path: "/me/tokens",
      operationId: "listPersonalAccessTokens",
      tags: ["identity"],
      security,
      responses: {
        200: json(
          z
            .object({ data: z.array(patSchema) })
            .strict()
            .openapi({ additionalProperties: true }),
        ),
        401: marketError,
        403: marketError,
      },
    }),
    async (c) => c.json(await new PatService(await dependencies.service()).list(c.req.raw), 200),
  );
  api.openapi(
    createRoute({
      method: "post",
      path: "/me/tokens",
      operationId: "createPersonalAccessToken",
      tags: ["identity"],
      security,
      request: {
        headers: z.object({
          "Idempotency-Key": z
            .string()
            .min(16)
            .max(64)
            .regex(/^[A-Za-z0-9_-]+$/),
        }),
        body: { required: true, content: { "application/json": { schema: patCreate } } },
      },
      responses: {
        201: { ...json(patCreated), headers: { "Cache-Control": { schema: { type: "string" } } } },
        401: marketError,
        403: marketError,
        409: conflictError,
        422: marketError,
        429: rateLimitedError,
      },
    }),
    async (c) => {
      const result = await new PatService(await dependencies.service()).create(
        c.req.raw,
        c.req.valid("json"),
        c.req.valid("header")["Idempotency-Key"],
      );
      c.header("Cache-Control", "no-store");
      if (!result.tokenShown) c.header("Idempotent-Replayed", "true");
      return c.json(result, 201);
    },
    (result) => {
      if (!result.success) throw new ProblemError("VALIDATION_FAILED");
    },
  );
  api.openapi(
    createRoute({
      method: "delete",
      path: "/me/tokens/{tokenId}",
      operationId: "revokePersonalAccessToken",
      tags: ["identity"],
      security,
      request: { params: z.object({ tokenId: z.uuid() }).strict() },
      responses: { 204: { description: "Odwołano." }, 401: marketError, 404: marketError },
    }),
    async (c) => {
      await new PatService(await dependencies.service()).revoke(
        c.req.raw,
        c.req.valid("param").tokenId,
      );
      return c.body(null, 204);
    },
  );
}
