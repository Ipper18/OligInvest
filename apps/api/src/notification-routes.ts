import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import type { AuthRouteDependencies } from "./auth/routes.js";
import {
  deliveryPageSchema,
  marketError,
  NotificationRepository,
  notificationPreferencesSchema as preferencesSchema,
  notificationStatusSchema as statusSchema,
} from "./modules.js";
import { mountPush } from "./push-routes.js";

export function mountNotifications(api: OpenAPIHono<AppEnv>, dependencies: AuthRouteDependencies) {
  mountPush(api, dependencies);
  for (const [method, path, operationId, response] of [
    ["get", "/notifications/preferences", "getNotificationPreferences", preferencesSchema],
    ["put", "/notifications/preferences", "replaceNotificationPreferences", preferencesSchema],
    ["get", "/notifications/deliveries", "listNotificationDeliveries", deliveryPageSchema],
  ] as const)
    api.openapi(
      createRoute({
        method,
        path,
        operationId,
        tags: ["notifications"],
        security: [{ sessionCookie: [] }],
        request:
          method === "put"
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: preferencesSchema } },
                },
              }
            : path.endsWith("deliveries")
              ? {
                  query: z
                    .object({
                      limit: z.coerce.number().int().min(1).max(200).default(50),
                      cursor: z.string().max(512).optional(),
                      status: statusSchema.optional(),
                    })
                    .strict(),
                }
              : {},
        responses: {
          200: {
            description: "Powiadomienia.",
            content: { "application/json": { schema: response } },
          },
          401: marketError,
          ...(method === "put" ? { 422: marketError } : { 403: marketError }),
        },
      }),
      async (c) => {
        const service = await dependencies.service(),
          principal = await service.requireData(c.req.raw);
        if (method !== "get") service.assertOrigin(c.req.raw);
        const context = { userId: principal.user_id, role: principal.role };
        const repository = new NotificationRepository(service.options.appDatabase);
        const data =
          method === "put"
            ? await repository.replace(context, await c.req.json())
            : path.endsWith("deliveries")
              ? await repository.deliveries(
                  context,
                  z
                    .object({
                      limit: z.coerce.number().int().min(1).max(200).default(50),
                      cursor: z.string().max(512).optional(),
                      status: statusSchema.optional(),
                    })
                    .strict()
                    .parse(c.req.query()),
                )
              : await repository.preferences(context);
        return c.json(data, 200);
      },
      (result) => {
        if (!result.success) throw new ProblemError("VALIDATION_FAILED");
      },
    );
}
