import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "./context.js";
import type { DatabaseTransaction } from "./transaction.js";

/**
 * Data retention (NFR-11.02, BL-115). Every period below comes from
 * docs/06-bezpieczenstwo/prywatnosc-rodo.md § 6 and docs/03-dane/model-danych.md § 4;
 * change the documents first, then this list. All work runs as `oliginvest_app` under
 * FORCE RLS: user-owned rows are removed in each owner's context, global rows in the
 * `system` context. Nothing here needs a superuser or a role that bypasses RLS.
 */
export const RETENTION_BATCH_SIZE = 500;
/** Monthly audit partitioning starts above 1 million rows (model-danych.md § 4). */
export const AUDIT_PARTITION_ROWS = 1_000_000;

export type RetentionTargetId =
  | "import_files"
  | "data_exports"
  | "data_export_metadata"
  | "notification_deliveries"
  | "role_quota_usage"
  | "idempotency_keys"
  | "invitations"
  | "invitation_emails"
  | "erasure_log"
  | "web_vitals"
  | "bars_intraday"
  | "news_items";

interface RetentionTarget {
  id: RetentionTargetId;
  scope: "user" | "system";
  batch(limit: number): SQL;
}

export const RETENTION_TARGETS: readonly RetentionTarget[] = Object.freeze([
  {
    // 90 days: the upload stores expires_at = upload + 90 days (portfolio imports).
    id: "import_files",
    scope: "user",
    batch: (limit) => sql`DELETE FROM portfolio.import_files WHERE batch_id IN (
      SELECT batch_id FROM portfolio.import_files WHERE expires_at <= now()
      ORDER BY expires_at, batch_id LIMIT ${limit})`,
  },
  {
    // 24 h or the first download: the ZIP goes, the metadata row stays for 2 years.
    id: "data_exports",
    scope: "user",
    batch: (limit) => sql`UPDATE identity.data_exports
      SET content = NULL, status = CASE WHEN status = 'ready' THEN 'expired' ELSE status END
      WHERE id IN (
        SELECT id FROM identity.data_exports
        WHERE (status = 'ready' AND (downloaded_at IS NOT NULL
                 OR coalesce(expires_at, created_at + interval '24 hours') <= now()))
           OR (status IN ('failed', 'expired') AND content IS NOT NULL)
        ORDER BY created_at, id LIMIT ${limit})`,
  },
  {
    // Export metadata (who exported when): 2 years, owner decision 2026-11-14 (BL-114).
    id: "data_export_metadata",
    scope: "user",
    batch: (limit) => sql`DELETE FROM identity.data_exports WHERE id IN (
      SELECT id FROM identity.data_exports
      WHERE created_at < now() - interval '2 years' AND status IN ('failed', 'expired')
      ORDER BY created_at, id LIMIT ${limit})`,
  },
  {
    id: "notification_deliveries",
    scope: "user",
    batch: (limit) => sql`DELETE FROM notifications.notification_deliveries WHERE id IN (
      SELECT id FROM notifications.notification_deliveries
      WHERE created_at < now() - interval '180 days'
      ORDER BY created_at, id LIMIT ${limit})`,
  },
  {
    // R-52: entries older than 7 × 24 h; the RLS DELETE policy enforces the same boundary.
    id: "role_quota_usage",
    scope: "user",
    batch: (limit) => sql`DELETE FROM platform.role_quota_usage WHERE operation_id IN (
      SELECT operation_id FROM platform.role_quota_usage
      WHERE consumed_at < now() - interval '168 hours'
      ORDER BY consumed_at, operation_id LIMIT ${limit})`,
  },
  {
    // Replay records live 24 h (expires_at); afterwards the key may be reused.
    id: "idempotency_keys",
    scope: "user",
    batch: (limit) => sql`DELETE FROM platform.idempotency_keys WHERE (user_id, key) IN (
      SELECT user_id, key FROM platform.idempotency_keys WHERE expires_at <= now()
      ORDER BY expires_at, key LIMIT ${limit})`,
  },
  {
    // Unused invitations: 30 days after expiry. The RLS policy limits `system` to these rows.
    id: "invitations",
    scope: "system",
    batch: (limit) => sql`DELETE FROM identity.invitations WHERE id IN (
      SELECT id FROM identity.invitations
      WHERE used_at IS NULL AND expires_at < now() - interval '30 days'
      ORDER BY expires_at, id LIMIT ${limit})`,
  },
  {
    // E-mail of a used invitation: anonymized 30 days after use (owner decision 2026-11-14,
    // BL-114). The RLS policy accepts only this exact replacement value.
    id: "invitation_emails",
    scope: "system",
    batch: (limit) => sql`UPDATE identity.invitations
      SET email = 'anonymized-' || id::text || '@example.invalid'
      WHERE id IN (
        SELECT id FROM identity.invitations
        WHERE used_at IS NOT NULL AND used_at < now() - interval '30 days'
          AND email <> 'anonymized-' || id::text || '@example.invalid'
        ORDER BY used_at, id LIMIT ${limit})`,
  },
  {
    // Erased account identifiers: 40 days, longer than the 35-day backup retention (backup-dr.md § 7).
    id: "erasure_log",
    scope: "system",
    batch: (limit) => sql`DELETE FROM platform.erasure_log WHERE erased_user_id IN (
      SELECT erased_user_id FROM platform.erasure_log WHERE purge_after <= now()
      ORDER BY purge_after, erased_user_id LIMIT ${limit})`,
  },
  {
    id: "web_vitals",
    scope: "system",
    batch: (limit) => sql`DELETE FROM platform.web_vitals WHERE id IN (
      SELECT id FROM platform.web_vitals WHERE recorded_at < now() - interval '90 days'
      ORDER BY recorded_at, id LIMIT ${limit})`,
  },
  {
    // Market data, no personal data: intraday bars 90 days (EOD bars are permanent).
    id: "bars_intraday",
    scope: "system",
    batch: (limit) => sql`DELETE FROM market.bars_intraday
      WHERE (instrument_id, interval, ts) IN (
        SELECT instrument_id, interval, ts FROM market.bars_intraday
        WHERE ts < now() - interval '90 days'
        ORDER BY ts, instrument_id, interval LIMIT ${limit})`,
  },
  {
    id: "news_items",
    scope: "system",
    batch: (limit) => sql`DELETE FROM market.news_items WHERE id IN (
      SELECT id FROM market.news_items WHERE published_at < now() - interval '90 days'
      ORDER BY published_at, id LIMIT ${limit})`,
  },
]);

export interface RetentionDatabase {
  transaction<T>(
    context: DatabaseContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface RetentionResult {
  target: RetentionTargetId;
  rows: number;
  /** True when another run held the target's lock, so this run left batches to it. */
  skipped: boolean;
}

const SYSTEM: DatabaseContext = { userId: null, role: "system" };
const batchSizeSchema = z.number().int().min(1).max(10_000);

/**
 * One batch in its own short transaction. A transaction-scoped advisory lock per target and
 * owner keeps two runs (another jobs instance, a manual retry) off the same rows at once; the
 * run that loses moves on instead of waiting, and the holder drains the rest. Returns null
 * when skipped.
 */
async function batch(
  database: RetentionDatabase,
  context: DatabaseContext,
  target: RetentionTarget,
  limit: number,
): Promise<number | null> {
  return database.transaction(context, async (tx) => {
    const key = `retention:${target.id}:${context.userId ?? "system"}`;
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 115)) AS acquired`,
    );
    if (lock.rows[0]?.acquired !== true) return null;
    return (await tx.execute(target.batch(limit))).rowCount ?? 0;
  });
}

async function drain(
  database: RetentionDatabase,
  context: DatabaseContext,
  target: RetentionTarget,
  limit: number,
  result: RetentionResult,
) {
  for (;;) {
    const rows = await batch(database, context, target, limit);
    if (rows === null) {
      result.skipped = true;
      return;
    }
    result.rows += rows;
    if (rows < limit) return;
  }
}

/** Idempotent: a repeated or concurrent run only finds fewer (or no) eligible rows. */
export async function runRetention(
  database: RetentionDatabase,
  options: { batchSize?: number } = {},
): Promise<RetentionResult[]> {
  const limit = batchSizeSchema.parse(options.batchSize ?? RETENTION_BATCH_SIZE);
  const results = new Map<RetentionTargetId, RetentionResult>(
    RETENTION_TARGETS.map(({ id }) => [id, { target: id, rows: 0, skipped: false }]),
  );
  const users = await database.transaction(SYSTEM, async (tx) =>
    (
      await tx.execute(sql`SELECT id::text AS id FROM identity.user_directory ORDER BY id`)
    ).rows.map((row) => z.uuid().parse(row.id)),
  );
  for (const target of RETENTION_TARGETS) {
    const result = results.get(target.id);
    if (!result) throw new Error("RETENTION_TARGET_MISSING");
    if (target.scope === "system") await drain(database, SYSTEM, target, limit, result);
    else
      for (const userId of users)
        await drain(database, { userId, role: "user" }, target, limit, result);
  }
  return [...results.values()];
}

/**
 * Extension point for audit partitions. `platform.audit_log` is append-only for the
 * application role (no DELETE, ADR-004), so its 2-year retention needs monthly partitions
 * created by a migration under the migration role. This only reports when the documented
 * threshold is passed; it never deletes audit rows.
 */
export async function auditPartitioningDue(database: RetentionDatabase) {
  const estimate = await database.transaction(SYSTEM, async (tx) => {
    const row = (
      await tx.execute(
        sql`SELECT greatest(reltuples, 0)::bigint::text AS estimate FROM pg_class WHERE oid = 'platform.audit_log'::regclass`,
      )
    ).rows[0];
    return Number(z.string().regex(/^\d+$/u).parse(row?.estimate));
  });
  return { estimate, due: estimate > AUDIT_PARTITION_ROWS };
}
