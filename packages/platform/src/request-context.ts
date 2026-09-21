import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LogEntry, PlatformLogger } from "./logger.js";
import { ProblemError, problemResponse } from "./problem.js";

export const identitySchema = z
  .object({ userId: z.uuid(), role: z.enum(["user", "pro", "admin"]) })
  .strict();
export type Identity = z.infer<typeof identitySchema>;
export type RequestContext = Readonly<{
  requestId: string;
  userId?: string | undefined;
  role?: Identity["role"] | undefined;
}>;
export interface AppEnv {
  Variables: { requestContext: RequestContext };
}
export interface PlatformContext {
  request: RequestContext;
  logger: PlatformLogger;
}
type RequestScope = {
  context: RequestContext;
  logger: PlatformLogger;
  authentication: { identity?: Identity };
};
const storage = new AsyncLocalStorage<RequestScope>();
function currentScope(): RequestScope {
  const scope = storage.getStore();
  if (!scope) throw new Error("No request context");
  return scope;
}
export function currentRequest(): RequestContext {
  return currentScope().context;
}
export function requestLogger(): PlatformLogger {
  const { context, logger } = currentScope();
  const bind = (entry: LogEntry): LogEntry => ({
    ...entry,
    request_id: context.requestId,
    user_id: context.userId,
  });
  return Object.freeze({
    info: (entry: LogEntry) => logger.info(bind(entry)),
    warn: (entry: LogEntry) => logger.warn(bind(entry)),
    error: (entry: LogEntry) => logger.error(bind(entry)),
  });
}
export function withIdentity<T>(identity: Identity, handler: () => T): T {
  const parsed = identitySchema.safeParse(identity);
  if (!parsed.success) throw new ProblemError("UNAUTHENTICATED");
  const scope = currentScope();
  const previous = scope.authentication.identity;
  if (previous && (previous.userId !== parsed.data.userId || previous.role !== parsed.data.role)) {
    throw new ProblemError("FORBIDDEN");
  }
  scope.authentication.identity = Object.freeze(parsed.data);
  return storage.run(
    {
      ...scope,
      context: Object.freeze({ ...scope.context, ...parsed.data }),
    },
    handler,
  );
}
export async function withRequestContext(
  request: Request,
  options: Readonly<{ logger: PlatformLogger; publicBaseUrl: string; route: string }>,
  handler: (context: RequestContext) => Promise<Response>,
): Promise<Response> {
  const candidate = z.uuid().safeParse(request.headers.get("X-Request-Id"));
  const requestId = candidate.success ? candidate.data : randomUUID();
  const context = Object.freeze({ requestId });
  const authentication: RequestScope["authentication"] = {};
  return storage.run({ context, logger: options.logger, authentication }, async () => {
    const started = performance.now();
    let response: Response;
    try {
      response = await handler(context);
    } catch (error) {
      response = problemResponse(error, requestId, options.publicBaseUrl);
      options.logger.error({
        event: "request.failed",
        request_id: requestId,
        user_id: authentication.identity?.userId,
        code: error instanceof ProblemError ? error.code : "INTERNAL",
      });
    }
    const headers = new Headers(response.headers);
    headers.set("X-Request-Id", requestId);
    options.logger.info({
      event: "request.completed",
      request_id: requestId,
      user_id: authentication.identity?.userId,
      route: options.route,
      status: response.status,
      duration_ms: performance.now() - started,
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
