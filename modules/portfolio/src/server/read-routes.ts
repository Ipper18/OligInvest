import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { marketError } from "@oliginvest/mod-market/server";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import {
  cashBalanceSchema,
  dayChangeResponse,
  lotPage,
  object,
  portfolioHistorySchema,
  portfolioSummary,
  positionsResponse,
  realizedResponse,
} from "../contracts.js";
import { readPortfolioHistory } from "./history.js";
import { readPortfolio } from "./read-service.js";
import { validationError } from "./repository.js";
import type { PortfolioDependencies } from "./routes.js";

const accounts = {
  accountId: z
    .array(z.uuid())
    .max(20)
    .optional()
    .openapi({ param: { style: "form", explode: true } }),
};
const view = z.enum(["economic", "tax"]).optional();
const definitions = [
  {
    operationId: "getPortfolioSummary",
    path: "summary",
    schema: portfolioSummary,
    query: z.object({ ...accounts, view }).strict(),
  },
  {
    operationId: "getDayChange",
    path: "day-change",
    schema: dayChangeResponse,
    query: z.object(accounts).strict(),
  },
  {
    operationId: "listPositions",
    path: "positions",
    schema: positionsResponse,
    query: z
      .object({
        ...accounts,
        asOf: z.string().date().optional(),
        view,
        groupBy: z.enum(["account_instrument", "instrument"]).default("account_instrument"),
      })
      .strict(),
  },
  {
    operationId: "getCashBalances",
    path: "cash",
    schema: object({ data: z.array(cashBalanceSchema) }),
    query: z.object({ ...accounts, asOf: z.string().date().optional() }).strict(),
  },
  {
    operationId: "listLots",
    path: "lots",
    schema: lotPage,
    query: z
      .object({
        ...accounts,
        instrumentId: z.uuid().optional(),
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        cursor: z.string().max(512).optional(),
      })
      .strict(),
  },
  {
    operationId: "getRealizedPl",
    path: "realized",
    schema: realizedResponse,
    query: z
      .object({
        ...accounts,
        view,
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        groupBy: z.enum(["day", "month", "year", "instrument", "account"]).default("month"),
      })
      .strict(),
  },
];
const historyQuery = z
  .object({
    ...accounts,
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    interval: z.enum(["1d", "1w", "1mo"]).default("1d"),
    maxPoints: z.coerce.number().int().min(50).max(3000).default(1500),
  })
  .strict();
function queryValues(url: string) {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(url).searchParams) {
    if (key === "accountId") values[key] = [...((values[key] as string[]) ?? []), value];
    else {
      if (key in values) throw new ProblemError("VALIDATION_FAILED");
      values[key] = value;
    }
  }
  return values;
}
export function mountPortfolioReads(api: OpenAPIHono<AppEnv>, deps: PortfolioDependencies) {
  const history = createRoute({
    method: "get",
    path: "/portfolio/history",
    operationId: "getPortfolioHistory",
    tags: ["portfolio"],
    security: [{ sessionCookie: [] }],
    request: { query: historyQuery },
    responses: {
      200: {
        description: "Seria.",
        content: { "application/json": { schema: portfolioHistorySchema } },
      },
      401: marketError,
      403: marketError,
      422: marketError,
    },
  });
  api.openAPIRegistry.registerPath(history);
  api.get(history.path, async (c) => {
    try {
      const values = queryValues(c.req.url);
      const principal = await deps.authorize(c.req.raw);
      const response = await readPortfolioHistory(
        await deps.repository(),
        principal,
        historyQuery.parse(values),
      );
      c.header("Cache-Control", "no-store");
      return c.json(response);
    } catch (error) {
      return validationError(error);
    }
  });
  for (const def of definitions) {
    const route = createRoute({
      method: "get",
      path: `/portfolio/${def.path}`,
      operationId: def.operationId,
      tags: ["portfolio"],
      security: [{ sessionCookie: [] }],
      request: { query: def.query },
      responses: {
        200: {
          description: "Dane portfela.",
          content: { "application/json": { schema: def.schema } },
          ...(def.path === "summary"
            ? { headers: { "Cache-Control": { schema: { type: "string" as const } } } }
            : {}),
        },
        401: marketError,
        403: marketError,
      },
    });
    api.openAPIRegistry.registerPath(route);
    api.get(route.path, async (c) => {
      try {
        const values = queryValues(c.req.url);
        const query = def.query.parse(values);
        const principal = await deps.authorize(c.req.raw);
        const response = await readPortfolio(
          await deps.repository(),
          principal,
          def.operationId,
          query,
        );
        c.header("Cache-Control", "no-store");
        return c.json(response);
      } catch (error) {
        return validationError(error);
      }
    });
  }
}
