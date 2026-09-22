import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type DatabaseContext, parseDatabaseContext } from "./context.js";

export type DatabaseRole = "oliginvest_app" | "oliginvest_auth" | "oliginvest_analytics_ro";
export type DatabaseTransaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

// Internal: applications receive the factories, never a raw pool or a role switch.
export async function runTransaction<T>(
  pool: Pool,
  expectedRole: DatabaseRole,
  input: DatabaseContext,
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  const context = parseDatabaseContext(input);
  const client = await pool.connect();
  let discard = false;
  const onError = () => {
    discard = true;
  };
  client.on("error", onError);
  try {
    const { rows } = await client.query<{
      role: string;
      session: string;
      privileged: boolean;
    }>(`SELECT current_user AS role, session_user AS session,
      (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR EXISTS (
        SELECT 1 FROM pg_roles p WHERE p.rolname <> current_user
          AND p.rolname IN ('oliginvest_owner', 'oliginvest_backup', 'oliginvest_auth',
            'oliginvest_app', 'oliginvest_analytics_ro', 'pg_read_all_data', 'pg_write_all_data')
          AND pg_has_role(current_user, p.rolname, 'MEMBER')
      )) AS privileged FROM pg_roles r WHERE r.rolname = current_user`);
    const identity = rows[0];
    if (
      !identity ||
      identity.role !== expectedRole ||
      identity.session !== expectedRole ||
      identity.privileged
    ) {
      discard = true;
      throw new Error("Database role does not match the required unprivileged identity");
    }
    return await drizzle(client).transaction(
      async (transaction) => {
        // true makes both settings local to this transaction, equivalent to SET LOCAL.
        await transaction.execute(sql`SELECT set_config('app.user_id', ${context.userId ?? ""}, true),
        set_config('app.role', ${context.role}, true)`);
        const result = await work(transaction);
        // PostgreSQL silently converts COMMIT to ROLLBACK for an aborted transaction.
        // Detect a SQL error swallowed by work(), so the caller cannot receive false success.
        await transaction.execute(sql`SELECT 1`);
        return result;
      },
      { accessMode: expectedRole === "oliginvest_analytics_ro" ? "read only" : "read write" },
    );
  } finally {
    if (!discard) {
      try {
        // Scrub even session-level changes made by a callback. Do not restore unsafe defaults.
        await client.query(
          "SELECT set_config('app.user_id', '', false), set_config('app.role', '', false)",
        );
      } catch {
        discard = true;
      }
    }
    client.removeListener("error", onError);
    client.release(discard);
  }
}
