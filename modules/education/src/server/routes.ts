import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppDatabase, DatabaseContext } from "@oliginvest/db";
import { marketError } from "@oliginvest/mod-market/server";
import { type AppEnv, ProblemError, requirePermission } from "@oliginvest/platform";
import { onboardingState, onboardingUpdate } from "../contracts.js";
import { OnboardingRepository } from "./onboarding.js";

export interface EducationDependencies {
  database(): AppDatabase | Promise<AppDatabase>;
  authorize(request: Request): Promise<DatabaseContext>;
  assertOrigin(request: Request): void | Promise<void>;
}
export function mountEducation(api: OpenAPIHono<AppEnv>, dependencies: EducationDependencies) {
  api.use("/education/*", async (c, next) => {
    const context = await dependencies.authorize(c.req.raw);
    requirePermission(context.role, "education:use");
    if (c.req.method !== "GET") await dependencies.assertOrigin(c.req.raw);
    c.header("Cache-Control", "no-store");
    await next();
  });
  const response = {
    description: "Stan onboardingu.",
    content: {
      "application/json": { schema: onboardingState.openapi({ additionalProperties: true }) },
    },
  };
  const base = {
    path: "/education/onboarding",
    tags: ["education"],
    security: [{ sessionCookie: [] }],
  };
  api.openapi(
    createRoute({
      ...base,
      method: "get",
      operationId: "getOnboardingState",
      responses: { 200: response, 401: marketError, 404: marketError },
    }),
    async (c) =>
      c.json(
        await new OnboardingRepository(await dependencies.database()).read(
          await dependencies.authorize(c.req.raw),
        ),
        200,
      ),
  );
  api.openapi(
    createRoute({
      ...base,
      method: "put",
      operationId: "updateOnboardingState",
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: onboardingUpdate.openapi({ additionalProperties: true }),
            },
          },
        },
      },
      responses: { 200: response, 401: marketError, 404: marketError, 422: marketError },
    }),
    async (c) =>
      c.json(
        await new OnboardingRepository(await dependencies.database()).update(
          await dependencies.authorize(c.req.raw),
          c.req.valid("json"),
        ),
        200,
      ),
    (result) => {
      if (!result.success) throw new ProblemError("VALIDATION_FAILED");
      return undefined;
    },
  );
}
