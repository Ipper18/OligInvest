import { marketError } from "./modules.js";

type RetryHeaders = {
  "Retry-After": { schema: { type: "integer"; minimum: number } };
};
type ErrorWithHeaders<T> = typeof marketError & {
  headers: typeof marketError.headers & T;
};

export const conflictError: ErrorWithHeaders<RetryHeaders> = {
  ...marketError,
  headers: {
    ...marketError.headers,
    "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
  },
};
export const rateLimitedError: ErrorWithHeaders<
  RetryHeaders & {
    RateLimit: { schema: { type: "string" } };
    "RateLimit-Policy": { schema: { type: "string" } };
  }
> = {
  ...marketError,
  headers: {
    ...marketError.headers,
    "Retry-After": { schema: { type: "integer" as const, minimum: 1 } },
    RateLimit: { schema: { type: "string" as const } },
    "RateLimit-Policy": { schema: { type: "string" as const } },
  },
};
