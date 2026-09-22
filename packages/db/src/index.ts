import pg from "pg";
import { z } from "zod";
import type { DatabaseContext } from "./context.js";
import { type DatabaseRole, type DatabaseTransaction, runTransaction } from "./transaction.js";

export type { DatabaseContext } from "./context.js";
export type { DatabaseTransaction } from "./transaction.js";

const optionsSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    database: z.string().min(1),
    password: z.string().min(1),
    max: z.number().int().min(1).max(10).default(5),
    ssl: z.boolean().default(false),
  })
  .strict();

export type DatabaseOptions = z.input<typeof optionsSchema>;
type Work<T> = (transaction: DatabaseTransaction) => Promise<T>;
export interface AppDatabase {
  transaction<T>(context: DatabaseContext, work: Work<T>): Promise<T>;
  close(): Promise<void>;
}
export interface ServiceDatabase {
  transaction<T>(work: Work<T>): Promise<T>;
  close(): Promise<void>;
}

function createPool(input: DatabaseOptions, role: DatabaseRole): pg.Pool {
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid database configuration");
  const options = parsed.data;
  const pool = new pg.Pool({
    ...options,
    user: role,
    options: "",
    ssl: options.ssl ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => {
    // pg removes failed idle clients itself; transactions report failures to their callers.
    // Driver error payloads may contain secrets and must not be logged here.
  });
  return pool;
}

export function createAppDatabase(options: DatabaseOptions): AppDatabase {
  const pool = createPool(options, "oliginvest_app");
  return Object.freeze({
    transaction: <T>(context: DatabaseContext, work: Work<T>) =>
      runTransaction(pool, "oliginvest_app", context, work),
    close: () => pool.end(),
  });
}

function createServiceDatabase(
  options: DatabaseOptions,
  role: Exclude<DatabaseRole, "oliginvest_app">,
): ServiceDatabase {
  const pool = createPool(options, role);
  return Object.freeze({
    transaction: <T>(work: Work<T>) =>
      runTransaction(pool, role, { userId: null, role: "anonymous" }, work),
    close: () => pool.end(),
  });
}

export function createAuthDatabase(options: DatabaseOptions): ServiceDatabase {
  return createServiceDatabase(options, "oliginvest_auth");
}

export function createAnalyticsDatabase(options: DatabaseOptions): ServiceDatabase {
  return createServiceDatabase(options, "oliginvest_analytics_ro");
}
