import { type AppDatabase, auditPartitioningDue, runRetention } from "@oliginvest/db";
import type { Metrics, PlatformLogger } from "@oliginvest/platform";
import type { Queue } from "bullmq";
import { z } from "zod";

export const RETENTION_JOB = "retention.run";

/**
 * Called by the nightly `portfolio.recompute-all` job (BL-115). Deduplication keeps at most
 * one retention job queued or running across jobs instances until it completes or fails;
 * the per-target advisory locks in `runRetention` cover any overlap that remains.
 */
export async function enqueueRetention(queue: Queue) {
  await queue.add(
    RETENTION_JOB,
    {},
    {
      deduplication: { id: RETENTION_JOB },
      removeOnComplete: true,
      removeOnFail: { age: 86400 },
    },
  );
}

/** Counts per target only: no identifiers or row contents reach logs or metrics. */
export async function processRetention(
  data: unknown,
  options: { database: AppDatabase; logger: PlatformLogger; metrics?: Metrics },
) {
  z.object({}).strict().parse(data);
  const started = Date.now();
  const results = await runRetention(options.database);
  for (const result of results) {
    options.metrics?.add("retention_rows_total", { target: result.target }, result.rows);
    if (result.skipped) options.metrics?.add("retention_skipped_total", { target: result.target });
  }
  const audit = await auditPartitioningDue(options.database);
  options.metrics?.gauge("audit_log_rows_estimate", {}, audit.estimate);
  if (audit.due)
    options.logger.warn({
      event: "retention.audit_partitioning_due",
      code: "AUDIT_PARTITIONING_DUE",
    });
  options.logger.info({ event: "retention.completed", duration_ms: Date.now() - started });
}
