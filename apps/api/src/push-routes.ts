import { randomUUID } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { pwaMessages } from "@oliginvest/i18n";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import type { AuthRouteDependencies } from "./auth/routes.js";
import {
  marketError,
  PushRepository,
  pushConfigurationSchema,
  pushCreateSchema,
  pushListSchema,
  pushSubscriptionSchema,
} from "./modules.js";
import { conflictError, rateLimitedError } from "./rate-limited-response.js";

const json = (schema: z.ZodType) => ({
  description: "Web Push.",
  content: { "application/json": { schema } },
});
const params = z.object({ subscriptionId: z.uuid() }).strict();
const hook = (result: { success: boolean }) => {
  if (!result.success) throw new ProblemError("VALIDATION_FAILED");
  return undefined;
};
export function mountPush(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  const common = { tags: ["notifications"], security: [{ sessionCookie: [] }] };
  api.openapi(
    createRoute({
      ...common,
      method: "get",
      path: "/notifications/push-config",
      operationId: "getPushConfiguration",
      responses: { 200: json(pushConfigurationSchema), 401: marketError, 403: marketError },
    }),
    async (c) => {
      const service = await dependencies.service();
      await service.requireData(c.req.raw);
      return c.json({ publicKey: service.options.pushPublicKey ?? null }, 200);
    },
  );
  api.openapi(
    createRoute({
      ...common,
      method: "get",
      path: "/notifications/push-subscriptions",
      operationId: "listPushSubscriptions",
      responses: { 200: json(pushListSchema), 401: marketError, 403: marketError },
    }),
    async (c) => {
      const service = await dependencies.service(),
        principal = await service.requireData(c.req.raw);
      return c.json(
        await new PushRepository(service.options.appDatabase).list({
          userId: principal.user_id,
          role: principal.role,
        }),
        200,
      );
    },
  );
  api.openapi(
    createRoute({
      ...common,
      method: "post",
      path: "/notifications/push-subscriptions",
      operationId: "createPushSubscription",
      request: {
        headers: z.object({
          "Idempotency-Key": z
            .string()
            .min(16)
            .max(64)
            .regex(/^[A-Za-z0-9_-]+$/),
        }),
        body: { required: true, content: { "application/json": { schema: pushCreateSchema } } },
      },
      responses: {
        201: json(pushSubscriptionSchema),
        401: marketError,
        403: marketError,
        404: marketError,
        409: conflictError,
        422: marketError,
      },
    }),
    async (c) => {
      const service = await dependencies.service(),
        principal = await service.requireData(c.req.raw);
      service.assertOrigin(c.req.raw);
      return c.json(
        await new PushRepository(service.options.appDatabase).create(
          { userId: principal.user_id, role: principal.role },
          c.req.valid("json"),
          c.req.header("user-agent") ?? null,
          c.req.valid("header")["Idempotency-Key"],
        ),
        201,
      );
    },
    hook,
  );
  api.openapi(
    createRoute({
      ...common,
      method: "delete",
      path: "/notifications/push-subscriptions/{subscriptionId}",
      operationId: "deletePushSubscription",
      request: { params },
      responses: { 204: { description: "Usunięto." }, 401: marketError, 404: marketError },
    }),
    async (c) => {
      const service = await dependencies.service(),
        principal = await service.requireData(c.req.raw);
      service.assertOrigin(c.req.raw);
      await new PushRepository(service.options.appDatabase).remove(
        { userId: principal.user_id, role: principal.role },
        c.req.valid("param").subscriptionId,
      );
      return c.body(null, 204);
    },
    hook,
  );
  api.openapi(
    createRoute({
      ...common,
      method: "post",
      path: "/notifications/push-subscriptions/{subscriptionId}/test",
      operationId: "sendTestPush",
      request: { params },
      responses: {
        202: { description: "Zlecono wysyłkę." },
        401: marketError,
        404: marketError,
        429: rateLimitedError,
      },
    }),
    async (c) => {
      const service = await dependencies.service(),
        principal = await service.requireData(c.req.raw);
      service.assertOrigin(c.req.raw);
      const subscriptionId = c.req.valid("param").subscriptionId;
      await new PushRepository(service.options.appDatabase).require(
        { userId: principal.user_id, role: principal.role },
        subscriptionId,
      );
      await service.options.state.limit(`push-test:${principal.user_id}`, 3, 60);
      if (!service.options.pushTest || !service.options.pushPublicKey)
        throw new ProblemError("SERVICE_UNAVAILABLE");
      const id = randomUUID();
      await service.options.pushTest(`push-test-${principal.user_id}-${id}`, {
        v: 1,
        userId: principal.user_id,
        kind: "system",
        sourceRef: `push-test:${id}`,
        channels: ["push"],
        subject: pwaMessages.testTitle,
        text: pwaMessages.testBody,
        url: "/ustawienia",
        subscriptionId,
        occurredAt: new Date().toISOString(),
      });
      return c.body(null, 202);
    },
    hook,
  );
}
