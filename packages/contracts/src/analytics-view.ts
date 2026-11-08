import { z } from "zod";
import {
  ANALYTICS_ERROR_CODES,
  goalResultSchema,
  monteCarloResultSchema,
  stressTestResultSchema,
} from "./analytics-jobs.js";
import { analyticsSeriesMetadataSchema } from "./analytics-metadata.js";

/** Read boundary for the three implemented analysis screens; calculations stay in the worker. */
export const analyticsRunViewSchema = z
  .object({
    id: z.uuid(),
    type: z.enum([
      "monte_carlo",
      "goal",
      "stress_test",
      "optimization",
      "what_if",
      "backtest",
      "rebalance",
    ]),
    status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
    progress: z.int().min(0).max(100),
    params: z.record(z.string(), z.unknown()),
    result: z
      .discriminatedUnion("kind", [
        monteCarloResultSchema,
        goalResultSchema,
        stressTestResultSchema,
      ])
      .optional(),
    assumptions: z.record(z.string(), z.unknown()).optional(),
    seriesMetadata: analyticsSeriesMetadataSchema.optional(),
    warnings: z
      .array(
        z
          .object({
            code: z.string(),
            severity: z.enum(["info", "warning", "critical"]),
            message: z.string(),
          })
          .strict(),
      )
      .optional(),
    compliance: z
      .object({
        disclaimerKey: z.string(),
        disclaimerVersion: z.string(),
        notInvestmentAdvice: z.literal(true),
        howToReadKey: z.string().optional(),
      })
      .strict(),
    reproducibility: z
      .object({
        seed: z.int().optional(),
        algorithmVersion: z.string().optional(),
        dataVersion: z.record(z.string(), z.unknown()).optional(),
        libraries: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    error: z
      .object({ code: z.enum(ANALYTICS_ERROR_CODES), message: z.string() })
      .strict()
      .optional(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().optional(),
    finishedAt: z.iso.datetime().optional(),
    durationMs: z.int().nonnegative().optional(),
  })
  .strict()
  .refine((run) => !run.result || run.result.kind === run.type);
export type AnalyticsRunView = z.infer<typeof analyticsRunViewSchema>;
export const analyticsRunsViewSchema = z
  .object({
    data: z.array(analyticsRunViewSchema),
    page: z.object({ hasMore: z.boolean(), nextCursor: z.string().optional() }).strict(),
  })
  .strict();
export const analyticsLimitsViewSchema = z
  .object({
    role: z.enum(["user", "pro", "admin"]),
    heavyRunsPerDay: z.number().int().nullable().optional(),
    heavyRunsUsedToday: z.int(),
    bounds: z.record(z.string(), z.number()),
    timeoutsSeconds: z.record(z.string(), z.int()).optional(),
  })
  .strict();
