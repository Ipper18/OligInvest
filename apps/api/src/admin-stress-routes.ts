import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  stressScenarioInputSchema,
  stressScenarioKeySchema,
  stressScenarioSchema,
} from "@oliginvest/contracts";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import type { IdentityDependencies } from "./auth/identity-routes.js";
import { adminModule, marketError } from "./modules.js";

// Create Hono schemas here: contracts may have been loaded before the OpenAPI Zod extension.
const inputSchema = z
  .object(stressScenarioInputSchema.shape)
  .strict()
  .openapi("StressScenarioInput", {
    additionalProperties: true,
  });
const outputSchema = z
  .object(stressScenarioSchema.shape)
  .strict()
  .openapi("StressScenario", { additionalProperties: true });

export function mountAdminStress(api: OpenAPIHono<AppEnv>, dependencies: IdentityDependencies) {
  if (!adminModule) return;
  const { upsertStressScenario } = adminModule;
  // Parse within Administration.http so malformed requests and failed gates are audited too.
  api.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      path: "/admin/analytics/stress-scenarios/{scenarioKey}",
      operationId: "adminUpsertStressScenario",
      tags: ["admin"],
      security: [{ sessionCookie: [] }],
      request: {
        params: z.object({ scenarioKey: stressScenarioKeySchema }).strict(),
        body: { required: true, content: { "application/json": { schema: inputSchema } } },
      },
      responses: {
        200: {
          description: "Zapisano.",
          content: { "application/json": { schema: outputSchema } },
        },
        401: marketError,
        403: marketError,
        404: marketError,
        422: marketError,
      },
    }),
  );
  api.put("/admin/analytics/stress-scenarios/:scenarioKey", async (context) => {
    const admin = await dependencies.administration();
    const result = await admin.http(
      context.req.raw,
      "admin.stress_scenario.upsert",
      async (actor, tx) => {
        if (!actor.userId || actor.role !== "admin") throw new ProblemError("FORBIDDEN");
        for (const flag of ["module.admin", "module.analytics"]) {
          if (!(await admin.service.features.enabled(flag, actor)))
            throw new ProblemError("NOT_FOUND");
        }
        let body: unknown;
        try {
          const reader = context.req.raw.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 16_384) {
                  await reader.cancel();
                  throw new Error("BODY_TOO_LARGE");
                }
                chunks.push(chunk.value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new ProblemError("VALIDATION_FAILED");
        }
        const input = stressScenarioInputSchema.safeParse(body);
        const key = stressScenarioKeySchema.safeParse(context.req.param("scenarioKey"));
        if (!input.success || !key.success) throw new ProblemError("VALIDATION_FAILED");
        return upsertStressScenario(tx, actor.userId, key.data, input.data);
      },
      {
        requestId: context.get("requestContext").requestId,
        ip: dependencies.clientIp(context),
      },
      (result) => ({
        resourceType: "stress_scenario",
        resourceId: result.after.key,
        before: result.before ? { stressScenario: result.before } : null,
        after: { stressScenario: result.after },
      }),
      { database: "app", permission: "admin:system" },
    );
    return context.json(outputSchema.parse(result.after), 200);
  });
}
