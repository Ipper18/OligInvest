import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { marketError } from "@oliginvest/mod-market/server";
import { type AppEnv, ProblemError } from "@oliginvest/platform";
import { keySchema } from "../contracts.js";
import {
  importBatchPage,
  importBatchSchema,
  importCommitSchema,
  importRowPage,
  importRowSchema,
  importUploadSchema,
  resolutionSchema,
  rowStatus,
} from "../import/contracts.js";
import { validationError } from "./repository.js";
import type { PortfolioDependencies } from "./routes.js";

const json = (schema: z.ZodType) => ({
  description: "Dane importu.",
  content: { "application/json": { schema } },
});
const errors = (...statuses: number[]) =>
  Object.fromEntries(
    statuses.map((code) => [
      code,
      {
        ...marketError,
        headers: {
          ...marketError.headers,
          ...([409, 429].includes(code)
            ? { "Retry-After": { schema: { type: "integer" as const, minimum: 1 } } }
            : {}),
          ...(code === 429
            ? {
                RateLimit: { schema: { type: "string" as const } },
                "RateLimit-Policy": { schema: { type: "string" as const } },
              }
            : {}),
        },
      },
    ]),
  );
const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
};
const listQuery = z
  .object({
    ...pagination,
    accountId: z
      .array(z.uuid())
      .max(20)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
  })
  .strict();
const rowsQuery = z
  .object({
    ...pagination,
    status: z
      .array(rowStatus)
      .optional()
      .openapi({ param: { style: "form", explode: true } }),
  })
  .strict();
const params = z.object({ importId: z.uuid() }).strict();
export function mountImports(api: OpenAPIHono<AppEnv>, deps: PortfolioDependencies) {
  const common = { tags: ["portfolio"], security: [{ sessionCookie: [] }] };
  const routes = [
    createRoute({
      ...common,
      method: "get",
      path: "/portfolio/imports",
      operationId: "listImports",
      request: { query: listQuery },
      responses: { 200: json(importBatchPage), ...errors(401, 403) },
    }),
    createRoute({
      ...common,
      method: "post",
      path: "/portfolio/imports",
      operationId: "uploadImport",
      request: {
        body: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: importUploadSchema,
              encoding: {
                file: {
                  contentType:
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv",
                },
              },
            },
          },
        },
      },
      responses: {
        202: {
          ...json(importBatchSchema),
          headers: { Location: { schema: { type: "string", format: "uri-reference" } } },
        },
        ...errors(401, 403, 409, 413, 415, 422, 429),
      },
    }),
    createRoute({
      ...common,
      method: "get",
      path: "/portfolio/imports/{importId}",
      operationId: "getImport",
      request: { params },
      responses: { 200: json(importBatchSchema), ...errors(401, 404) },
    }),
    createRoute({
      ...common,
      method: "delete",
      path: "/portfolio/imports/{importId}",
      operationId: "discardImport",
      request: { params },
      responses: { 204: { description: "Odrzucono." }, ...errors(401, 404, 409) },
    }),
    createRoute({
      ...common,
      method: "get",
      path: "/portfolio/imports/{importId}/rows",
      operationId: "listImportRows",
      request: { params, query: rowsQuery },
      responses: { 200: json(importRowPage), ...errors(401, 404) },
    }),
    createRoute({
      ...common,
      method: "patch",
      path: "/portfolio/imports/{importId}/rows/{rowId}",
      operationId: "resolveImportRow",
      request: {
        params: params.extend({ rowId: z.uuid() }).strict(),
        body: { required: true, content: { "application/json": { schema: resolutionSchema } } },
      },
      responses: { 200: json(importRowSchema), ...errors(401, 404, 409, 422) },
    }),
    createRoute({
      ...common,
      method: "post",
      path: "/portfolio/imports/{importId}/commit",
      operationId: "commitImport",
      request: {
        params,
        headers: z.object({ "Idempotency-Key": keySchema }),
        body: { required: false, content: { "application/json": { schema: importCommitSchema } } },
      },
      responses: { 200: json(importBatchSchema), ...errors(401, 404, 409, 412) },
    }),
  ];
  for (const route of routes) {
    api.openAPIRegistry.registerPath(route);
    api.on(route.method, route.path.replace(/\{([^}]+)\}/g, ":$1"), async (c) => {
      try {
        if (!deps.imports) throw new ProblemError("SERVICE_UNAVAILABLE");
        const context = await deps.authorize(c.req.raw),
          repo = await deps.imports();
        const id = c.req.param("importId");
        if (id) z.uuid().parse(id);
        const query: Record<string, unknown> = {};
        for (const [key, value] of new URL(c.req.url).searchParams) {
          if (["status", "accountId"].includes(key))
            query[key] = [...((query[key] as string[]) ?? []), value];
          else {
            if (key in query) throw new ProblemError("VALIDATION_FAILED");
            query[key] = value;
          }
        }
        switch (route.operationId) {
          case "listImports":
            return c.json(await repo.list(context, listQuery.parse(query)));
          case "getImport":
            return c.json(await repo.get(context, id!));
          case "discardImport":
            await repo.discard(context, id!);
            return c.body(null, 204);
          case "listImportRows": {
            const q = rowsQuery.parse(query);
            return c.json(await repo.list(context, q, id!, q.status));
          }
          case "resolveImportRow":
            return c.json(
              await repo.resolve(
                context,
                id!,
                z.uuid().parse(c.req.param("rowId")),
                await c.req.json(),
              ),
            );
          case "commitImport": {
            const text = await c.req.text();
            const result = await repo.commit(
              context,
              id!,
              text ? JSON.parse(text) : {},
              keySchema.parse(c.req.header("Idempotency-Key")),
            );
            if (result.replayed) c.header("Idempotent-Replayed", "true");
            return c.json(result.value);
          }
          case "uploadImport": {
            let form: FormData;
            try {
              form = await c.req.formData();
            } catch {
              throw new ProblemError("BAD_REQUEST");
            }
            const values: Record<string, unknown> = {};
            for (const [key, value] of form) {
              if (key in values) throw new ProblemError("VALIDATION_FAILED");
              values[key] = value;
            }
            const upload = z
              .object({
                file: z.instanceof(File),
                accountId: z.uuid(),
                source: z.enum(["auto", "xtb", "mbank", "generic"]).default("auto"),
                templateId: z.uuid().optional(),
              })
              .strict()
              .parse(values);
            if (upload.file.size > 10485760) throw new ProblemError("FILE_TOO_LARGE");
            if (upload.templateId) throw new ProblemError("IMPORT_FORMAT_UNKNOWN");
            const result = await repo.upload(context, {
              accountId: upload.accountId,
              fileName: upload.file.name,
              source: upload.source,
              contentType: upload.file.type,
              content: new Uint8Array(await upload.file.arrayBuffer()),
            });
            c.header("Location", `/api/v1/portfolio/imports/${result.id}`);
            return c.json(result, 202);
          }
        }
        throw new ProblemError("NOT_FOUND");
      } catch (error) {
        if (error instanceof SyntaxError) throw new ProblemError("BAD_REQUEST");
        return validationError(error);
      }
    });
  }
}
