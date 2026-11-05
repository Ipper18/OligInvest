import { z } from "zod";
import { permissionsForRole } from "./access.js";
import { ProblemError } from "./problem.js";

export const DEFAULT_HEAVY_RUNS_PER_DAY = 20;
const configuredLimit = z.number().int().nonnegative();

export function resolveHeavyAnalysisLimit(role: unknown, configured: unknown): number | null {
  if (!permissionsForRole(role).includes("analytics:run:heavy")) return null;
  // Only absence selects the default. Invalid stored configuration must fail closed.
  return configuredLimit.parse(configured === undefined ? DEFAULT_HEAVY_RUNS_PER_DAY : configured);
}

/** Structural port: the adapter validates dailyRoleQuotaSchema from contracts at its boundary. */
export interface DailyRoleQuota {
  readonly limit: number | null;
  readonly used: number;
  readonly observedAt: string;
  readonly resetAt: string;
}

/** Call inside the transaction/owner lock that also records the accepted operation. */
export function enforceDailyRoleQuota(quota: DailyRoleQuota): void {
  if (quota.limit === null) throw new ProblemError("FORBIDDEN");
  if (quota.used >= quota.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(quota.resetAt) - Date.parse(quota.observedAt)) / 1000),
    );
    throw new ProblemError("QUOTA_EXCEEDED", { retryAfterSeconds });
  }
}
