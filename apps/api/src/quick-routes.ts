import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { formatMessage, quickMessages } from "@oliginvest/i18n";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { PatService } from "./auth/pat-service.js";
import type { AuthRouteDependencies } from "./auth/routes.js";
import {
  alertsModule,
  MarketRepository,
  marketError,
  type PortfolioDependencies,
  quickModule,
  readPortfolio,
} from "./modules.js";
import { conflictError, rateLimitedError } from "./rate-limited-response.js";

const format = z.enum(["json", "text"]).default("json");
export function mountQuick(
  api: OpenAPIHono<AppEnv>,
  auth: AuthRouteDependencies,
  portfolio?: PortfolioDependencies,
) {
  if (!quickModule) return;
  const {
    QuickRepository,
    quickText,
    quickPortfolioResponse,
    quickTodayResponse,
    quickQuoteResponse,
    quickCreated,
    quickAlerts,
    quickTransactionInput,
    ticker: quickTicker,
    mic: quickMic,
  } = quickModule;
  api.openAPIRegistry.registerComponent("securitySchemes", "bearerPat", {
    type: "http",
    scheme: "bearer",
  });
  const definitions = [
    ["portfolio", "get", "quickGetPortfolio", "portfolio:read", quickPortfolioResponse],
    ["today", "get", "quickGetToday", "portfolio:read", quickTodayResponse],
    ["quote", "get", "quickGetQuote", "market:read", quickQuoteResponse],
    ["transactions", "post", "quickCreateTransaction", "transactions:write", quickCreated],
    ["alerts", "get", "quickGetAlerts", "alerts:read", quickAlerts],
  ] as const;
  for (const [name, method, operationId, scope, schema] of definitions) {
    if (name === "alerts" && !alertsModule) continue;
    const query = z
      .object({
        format,
        ...(name === "quote" ? { ticker: quickTicker, mic: quickMic.optional() } : {}),
        ...(name === "alerts" ? { limit: z.coerce.number().int().min(1).max(10).default(5) } : {}),
      })
      .strict();
    const route = createRoute({
      method,
      path: `/quick/${name}`,
      operationId,
      tags: ["quick"],
      security: [{ bearerPat: [scope] }],
      request: {
        query,
        ...(method === "post"
          ? {
              headers: z.object({
                "Idempotency-Key": z
                  .string()
                  .min(16)
                  .max(64)
                  .regex(/^[A-Za-z0-9_-]+$/),
              }),
              body: {
                required: true,
                content: { "application/json": { schema: quickTransactionInput } },
              },
            }
          : {}),
      },
      responses: {
        ...(method === "post"
          ? {
              201: {
                description: "Szybka akcja.",
                content: { "application/json": { schema }, "text/plain": { schema: z.string() } },
              },
            }
          : {
              200: {
                description: "Szybka akcja.",
                content: { "application/json": { schema }, "text/plain": { schema: z.string() } },
              },
            }),
        401: marketError,
        403: marketError,
        404: marketError,
        409: conflictError,
        422: marketError,
        429: rateLimitedError,
      },
    });
    api.openAPIRegistry.registerPath(route);
    api.on(method.toUpperCase(), route.path, async (c) => {
      try {
        const service = await auth.service(),
          principal = await new PatService(service).authorize(c.req.raw, scope, auth.clientIp(c));
        const context = { userId: principal.userId, role: principal.role };
        if (
          !(await service.features.enabled(
            name === "alerts" ? "module.alerts" : "module.quick-actions",
            context,
          ))
        )
          throw new ProblemError("NOT_FOUND");
        c.header("Cache-Control", "no-store");
        c.header("Vary", "Authorization");
        const params = query.parse(c.req.query());
        if (name === "alerts") {
          const result = await service.options.appDatabase.transaction(context, async (tx) => {
            const count = (
              await tx.execute(sql`SELECT count(*)::int AS n FROM alerts.alert_rules WHERE enabled`)
            ).rows[0]?.n;
            const rows = (
              await tx.execute(
                sql`SELECT e.triggered_at,e.payload->>'message' AS message,i.ticker FROM alerts.alert_events e JOIN alerts.alert_rules r ON r.id=e.rule_id LEFT JOIN market.instruments i ON i.id=r.instrument_id ORDER BY e.triggered_at DESC,e.id DESC LIMIT ${params.limit ?? 5}`,
              )
            ).rows;
            return quickAlerts.parse({
              activeRules: count,
              triggered: rows.map((r) => ({
                at: z.coerce.date().parse(r.triggered_at).toISOString(),
                message: r.message,
                ...(r.ticker ? { ticker: r.ticker } : {}),
              })),
            });
          });
          return params.format === "text"
            ? c.text(
                [
                  formatMessage(quickMessages.alerts, { count: String(result.activeRules) }),
                  ...result.triggered.map((r: { message: string }) => r.message),
                ].join("\n"),
                200,
              )
            : c.json(result, 200);
        }
        if (!portfolio) throw new ProblemError("SERVICE_UNAVAILABLE");
        const portfolioRepository = await portfolio.repository();
        const repository = new QuickRepository(
          portfolioRepository,
          readPortfolio,
          new MarketRepository(portfolioRepository.database, portfolioRepository.now),
        );
        if (name === "transactions") {
          const result = await repository.create(
            context,
            principal.tokenId,
            await c.req.json(),
            z
              .string()
              .min(16)
              .max(64)
              .regex(/^[A-Za-z0-9_-]+$/)
              .parse(c.req.header("Idempotency-Key")),
          );
          if (result.replayed) c.header("Idempotent-Replayed", "true");
          return params.format === "text"
            ? c.text(result.data.summary, 201)
            : c.json(result.data, 201);
        }
        const result =
          name === "quote"
            ? await repository.quote(
                context,
                quickTicker.parse(params.ticker),
                params.mic === undefined ? undefined : quickMic.parse(params.mic),
              )
            : await repository.snapshot(context, name);
        return params.format === "text"
          ? c.text(quickText(name, result), 200)
          : c.json(result, 200);
      } catch (error) {
        if (error instanceof z.ZodError) throw new ProblemError("VALIDATION_FAILED");
        throw error;
      }
    });
  }
}
