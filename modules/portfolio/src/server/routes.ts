import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { DatabaseContext } from "@oliginvest/db";
import { marketError } from "@oliginvest/mod-market/server";
import { type AppEnv, ProblemError, requirePermission } from "@oliginvest/platform";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  accountInput,
  accountPatch,
  accountSchema,
  keySchema,
  object,
  transactionInput,
  transactionPage,
  transactionPatch,
  transactionSchema,
} from "../contracts.js";
import { mountImports } from "./import-routes.js";
import type { ImportRepository } from "./imports.js";
import { type PortfolioRepository, validationError } from "./repository.js";

export interface PortfolioDependencies {
  repository(): PortfolioRepository | Promise<PortfolioRepository>;
  authorize(request: Request, stepUp?: boolean): Promise<DatabaseContext>;
  assertOrigin(request: Request): void | Promise<void>;
  imports?(): ImportRepository | Promise<ImportRepository>;
}
const json = (schema: z.ZodType) => ({
  description: "Dane portfela.",
  content: { "application/json": { schema } },
});
const body = (schema: z.ZodType) => ({
  required: true,
  content: { "application/json": { schema } },
});
const security = [{ sessionCookie: [] }];
const conflict = {
  ...marketError,
  headers: {
    ...marketError.headers,
    "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
  },
};
const pathParams = (name: string) => z.object({ [name]: z.uuid() }).strict();
const accountQuery = z
  .object({
    includeClosed: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional()
      .openapi({ type: "boolean", default: false }),
  })
  .strict();
export const transactionsQuery = z
  .object({
    accountId: z
      .array(z.uuid())
      .max(20)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
    instrumentId: z.uuid().optional(),
    type: z
      .array(transactionInput.shape.type)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    sort: z.enum(["tradeDate", "-tradeDate", "createdAt", "-createdAt"]).default("-tradeDate"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().max(512).optional(),
  })
  .strict();
function query(request: Request) {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key === "type" || key === "accountId")
      result[key] = [...((result[key] as string[]) ?? []), value];
    else {
      if (key in result) throw new ProblemError("VALIDATION_FAILED");
      result[key] = value;
    }
  }
  return result;
}
const location = { Location: { schema: { type: "string" as const, format: "uri-reference" } } };
export function mountPortfolio(api: OpenAPIHono<AppEnv>, deps: PortfolioDependencies) {
  api.use("/portfolio/*", async (c, next) => {
    const principal = await deps.authorize(
      c.req.raw,
      c.req.method === "DELETE" && /^\/api\/v1\/portfolio\/accounts\/[^/]+$/.test(c.req.path),
    );
    await deps.assertOrigin(c.req.raw);
    if (!principal.userId || !["user", "pro", "admin"].includes(principal.role))
      throw new ProblemError("FORBIDDEN");
    requirePermission(
      principal.role as "user" | "pro" | "admin",
      c.req.method === "GET"
        ? "portfolio:read"
        : c.req.path.includes("/accounts")
          ? "portfolio:write"
          : "transactions:write",
    );
    await next();
  });
  api.use(
    "/portfolio/*",
    bodyLimit({
      maxSize: 10 * 1024 * 1024 + 65536,
      onError: () => {
        throw new ProblemError("FILE_TOO_LARGE");
      },
    }),
  );
  const routes = [
    createRoute({
      method: "get",
      path: "/portfolio/accounts",
      operationId: "listAccounts",
      tags: ["portfolio"],
      security,
      request: { query: accountQuery },
      responses: {
        200: json(object({ data: z.array(accountSchema) })),
        401: marketError,
        403: marketError,
      },
    }),
    createRoute({
      method: "post",
      path: "/portfolio/accounts",
      operationId: "createAccount",
      tags: ["portfolio"],
      security,
      request: {
        headers: z.object({ "Idempotency-Key": keySchema.optional() }),
        body: body(accountInput),
      },
      responses: {
        201: { ...json(accountSchema), headers: location },
        401: marketError,
        403: marketError,
        422: marketError,
      },
    }),
    createRoute({
      method: "get",
      path: "/portfolio/accounts/{accountId}",
      operationId: "getAccount",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("accountId") },
      responses: { 200: json(accountSchema), 401: marketError, 404: marketError },
    }),
    createRoute({
      method: "patch",
      path: "/portfolio/accounts/{accountId}",
      operationId: "updateAccount",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("accountId"), body: body(accountPatch) },
      responses: { 200: json(accountSchema), 401: marketError, 404: marketError, 422: marketError },
    }),
    createRoute({
      method: "delete",
      path: "/portfolio/accounts/{accountId}",
      operationId: "deleteAccount",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("accountId") },
      responses: {
        204: { description: "Usunięto." },
        401: marketError,
        403: marketError,
        404: marketError,
      },
    }),
    createRoute({
      method: "get",
      path: "/portfolio/transactions",
      operationId: "listTransactions",
      tags: ["portfolio"],
      security,
      request: { query: transactionsQuery },
      responses: {
        200: json(transactionPage),
        401: marketError,
        403: marketError,
        422: marketError,
      },
    }),
    createRoute({
      method: "post",
      path: "/portfolio/transactions",
      operationId: "createTransaction",
      tags: ["portfolio"],
      security,
      request: {
        headers: z.object({ "Idempotency-Key": keySchema }),
        body: body(transactionInput),
      },
      responses: {
        201: {
          ...json(transactionSchema),
          headers: {
            ...location,
            "Idempotent-Replayed": { schema: { type: "string" as const, enum: ["true"] } },
          },
        },
        401: marketError,
        403: marketError,
        404: marketError,
        409: conflict,
        422: marketError,
      },
    }),
    createRoute({
      method: "get",
      path: "/portfolio/transactions/{transactionId}",
      operationId: "getTransaction",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("transactionId") },
      responses: { 200: json(transactionSchema), 401: marketError, 404: marketError },
    }),
    createRoute({
      method: "patch",
      path: "/portfolio/transactions/{transactionId}",
      operationId: "updateTransaction",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("transactionId"), body: body(transactionPatch) },
      responses: {
        200: json(transactionSchema),
        401: marketError,
        404: marketError,
        422: marketError,
      },
    }),
    createRoute({
      method: "delete",
      path: "/portfolio/transactions/{transactionId}",
      operationId: "deleteTransaction",
      tags: ["portfolio"],
      security,
      request: { params: pathParams("transactionId") },
      responses: { 204: { description: "Usunięto." }, 401: marketError, 404: marketError },
    }),
  ];
  mountImports(api, deps);
  for (const route of routes) {
    api.openAPIRegistry.registerPath(route);
    api.on(route.method, route.path.replace(/\{([^}]+)\}/g, ":$1"), async (c: Context<AppEnv>) => {
      try {
        const principal = await deps.authorize(c.req.raw);
        const repo = await deps.repository();
        const id = c.req.param("accountId") ?? c.req.param("transactionId");
        if (id) z.uuid().parse(id);
        const input = async () => {
          try {
            return await c.req.json();
          } catch {
            throw new ProblemError("BAD_REQUEST");
          }
        };
        switch (route.operationId) {
          case "listAccounts":
            return c.json(
              await repo.listAccounts(
                principal,
                accountQuery.parse(query(c.req.raw)).includeClosed ?? false,
              ),
            );
          case "createAccount": {
            const r = await repo.createAccount(
              principal,
              await input(),
              c.req.header("Idempotency-Key"),
            );
            c.header("Location", `/api/v1/portfolio/accounts/${r.value.id}`);
            if (r.replayed) c.header("Idempotent-Replayed", "true");
            return c.json(r.value, 201);
          }
          case "getAccount":
            return c.json(await repo.getAccount(principal, id!));
          case "updateAccount":
            return c.json(await repo.updateAccount(principal, id!, await input()));
          case "deleteAccount":
            await repo.deleteAccount(principal, id!);
            return c.body(null, 204);
          case "listTransactions":
            return c.json(
              await repo.listTransactions(principal, transactionsQuery.parse(query(c.req.raw))),
            );
          case "createTransaction": {
            const key = keySchema.parse(c.req.header("Idempotency-Key"));
            const r = await repo.createTransaction(principal, await input(), key);
            c.header("Location", `/api/v1/portfolio/transactions/${r.value.id}`);
            if (r.replayed) c.header("Idempotent-Replayed", "true");
            return c.json(r.value, 201);
          }
          case "getTransaction":
            return c.json(await repo.getTransaction(principal, id!));
          case "updateTransaction":
            return c.json(await repo.updateTransaction(principal, id!, await input()));
          case "deleteTransaction":
            await repo.deleteTransaction(principal, id!);
            return c.body(null, 204);
        }
        throw new ProblemError("NOT_FOUND");
      } catch (error) {
        return validationError(error);
      }
    });
  }
}
