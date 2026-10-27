import {
  type AnalyticsResult,
  analyticsProgressSchema,
  analyticsResultSchema,
} from "@oliginvest/contracts";
import type { AppDatabase, DatabaseTransaction } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export interface RunEvent {
  event: "analytics.run.progress" | "analytics.run.completed" | "analytics.run.failed";
  data: Record<string, unknown>;
}
/**
 * jobs side of BL-312. The queue carries only `runId`; the owner is `analytics_runs.user_id`, read
 * through `analytics.run_owner` (system context), and every write happens under that owner's RLS
 * context. Handlers are idempotent: a terminal run is never overwritten (retries, duplicates).
 */
export function createAnalyticsResults(options: {
  database: AppDatabase;
  publish(userId: string, event: RunEvent): Promise<void>;
}) {
  const { database } = options;
  async function ownerOf(runId: string) {
    const row = (
      await database.transaction({ userId: null, role: "system" }, (tx) =>
        tx.execute(sql`SELECT analytics.run_owner(${z.uuid().parse(runId)}::uuid)::text AS owner`),
      )
    ).rows[0];
    return row?.owner ? z.uuid().parse(row.owner) : undefined;
  }
  const asOwner = <T>(userId: string, work: (tx: DatabaseTransaction) => Promise<T>) =>
    database.transaction({ userId, role: "user" }, work);

  async function handleResult(raw: unknown) {
    const result: AnalyticsResult = analyticsResultSchema.parse(raw);
    const userId = await ownerOf(result.runId);
    if (!userId) return; // Deleted by its owner meanwhile: nothing to store.
    const stored = await asOwner(userId, async (tx) => {
      const current = (
        await tx.execute(
          sql`SELECT type,assumptions,warnings FROM analytics.analytics_runs WHERE id=${result.runId}::uuid AND status IN ('queued','running') FOR UPDATE`,
        )
      ).rows[0];
      if (!current) return undefined;
      const finished = sql`finished_at=${result.finishedAt}::timestamptz,duration_ms=${result.durationMs},started_at=coalesce(started_at,${result.finishedAt}::timestamptz-make_interval(secs=>${result.durationMs / 1000}))`;
      // A result of another analysis kind never lands on this run (defence in depth).
      if (result.status === "done" && result.result.kind !== current.type) {
        await tx.execute(
          sql`UPDATE analytics.analytics_runs SET status='failed',error='INTERNAL',${finished} WHERE id=${result.runId}::uuid`,
        );
        return { type: String(current.type), errorCode: "INTERNAL" };
      }
      if (result.status === "done") {
        const assumptions = {
          ...((current.assumptions as object | null) ?? {}),
          ...result.assumptions,
        };
        const warnings = [...((current.warnings as unknown[]) ?? []), ...result.warnings];
        const dataVersion = {
          series: result.reproducibility.dataVersion,
          libraries: result.reproducibility.libraries,
        };
        await tx.execute(
          sql`UPDATE analytics.analytics_runs SET status='done',progress=100,result=${JSON.stringify(result.result)}::jsonb,assumptions=${JSON.stringify(assumptions)}::jsonb,warnings=${JSON.stringify(warnings)}::jsonb,data_version=${JSON.stringify(dataVersion)}::jsonb,error=NULL,${finished} WHERE id=${result.runId}::uuid`,
        );
      } else
        await tx.execute(
          sql`UPDATE analytics.analytics_runs SET status=${result.status},error=${result.status === "failed" ? result.error.code : null},${finished} WHERE id=${result.runId}::uuid`,
        );
      return { type: String(current.type), errorCode: undefined };
    });
    if (!stored) return;
    const { type, errorCode } = stored;
    await options.publish(
      userId,
      result.status === "done" && !errorCode
        ? { event: "analytics.run.completed", data: { v: 1, runId: result.runId, type } }
        : {
            event: "analytics.run.failed",
            data: {
              v: 1,
              runId: result.runId,
              errorCode:
                errorCode ?? (result.status === "failed" ? result.error.code : "CANCELLED"),
            },
          },
    );
  }

  /** BullMQ progress of the worker job (≥ 2 s or 10 % apart, realtime.md § 4). */
  async function handleProgress(runId: string, raw: unknown) {
    const progress = analyticsProgressSchema.safeParse(raw);
    if (!progress.success) return;
    const userId = await ownerOf(runId);
    if (!userId) return;
    const updated = await asOwner(
      userId,
      async (tx) =>
        (
          await tx.execute(
            sql`UPDATE analytics.analytics_runs SET status='running',progress=greatest(progress,${progress.data.progress}),started_at=coalesce(started_at,now()) WHERE id=${runId}::uuid AND status IN ('queued','running') RETURNING id`,
          )
        ).rows.length,
    );
    if (updated)
      await options.publish(userId, {
        event: "analytics.run.progress",
        data: { v: 1, runId, progress: progress.data.progress, stage: progress.data.stage },
      });
  }

  /** The worker job failed without producing a result (crash, stalled job, invalid payload). */
  async function handleWorkerFailure(runId: string) {
    await handleResult({
      v: 1,
      runId,
      status: "failed",
      error: { code: "INTERNAL" },
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    });
  }

  return { handleResult, handleProgress, handleWorkerFailure, ownerOf };
}
