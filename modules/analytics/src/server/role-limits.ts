import { dailyRoleQuotaSchema } from "@oliginvest/contracts";
import type { DatabaseTransaction } from "@oliginvest/db";
import { resolveHeavyAnalysisLimit } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const HEAVY_TYPES = new Set([
  "monte_carlo",
  "optimization",
  "stress_test",
  "backtest",
  "goal",
]);
const policyRow = z.object({ limits: z.record(z.string(), z.unknown()) }).strict();
const databaseTimestamp = z.union([z.string(), z.date()]).pipe(z.coerce.date());
const usageRow = z
  .object({
    used: z.number().int().nonnegative(),
    observedAt: databaseTimestamp,
    resetAt: databaseTimestamp,
  })
  .strict();

/** PostgreSQL clock in production; explicit instant only for calendar integration tests. */
export async function readHeavyRoleQuota(
  tx: DatabaseTransaction,
  role: "user" | "pro" | "admin",
  at?: Date,
) {
  const raw = (await tx.execute(sql`SELECT limits FROM platform.role_limits WHERE role=${role}`))
    .rows[0];
  const configured =
    raw === undefined ? undefined : policyRow.parse(raw).limits.analytics_heavy_per_day;
  const limit = resolveHeavyAnalysisLimit(role, configured);
  const instant = at === undefined ? sql`clock_timestamp()` : sql`${at.toISOString()}::timestamptz`;
  const usage = usageRow.parse(
    (
      await tx.execute(sql`
        WITH clock AS MATERIALIZED (SELECT ${instant} AS instant),
        quota_window AS (
          SELECT instant,
            (instant AT TIME ZONE 'Europe/Warsaw')::date::timestamp AT TIME ZONE 'Europe/Warsaw' AS start_at,
            ((instant AT TIME ZONE 'Europe/Warsaw')::date + 1)::timestamp AT TIME ZONE 'Europe/Warsaw' AS reset_at
          FROM clock
        )
        SELECT (SELECT count(*)::int FROM platform.role_quota_usage
          WHERE quota_key='analytics_heavy_per_day'
            AND consumed_at>=quota_window.start_at AND consumed_at<quota_window.reset_at) AS used,
          instant AS "observedAt", reset_at AS "resetAt" FROM quota_window
      `)
    ).rows[0],
  );
  return dailyRoleQuotaSchema.parse({
    role,
    limit,
    used: usage.used,
    observedAt: usage.observedAt.toISOString(),
    resetAt: usage.resetAt.toISOString(),
  });
}
