import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { dataExportJobSchema, GDPR_LIMITS } from "./contracts.js";
import {
  buildExportArchive,
  EXPORT_MAX_BYTES,
  type ExportDataset,
  type ExportValue,
} from "./domain/export-archive.js";

/**
 * GDPR rights in the database (BL-114, FR-07.09, NFR-11.02). Every table that holds personal
 * data has a `user_id` column (model-danych.md); the export lists those tables from the catalog
 * at run time, so a new table cannot silently fall out of it. Account data in the `auth` schema
 * (no grant for the application role) comes from `identity.export_auth_data()`, which returns an
 * allowlist of columns without secrets. Erasure runs `identity.erase_account()` (system context,
 * due requests only) and records the identifier in `platform.erasure_log` and in a file outside
 * the database for re-erasure after a backup restore (backup-dr.md § 7).
 */
export interface GdprDatabase {
  transaction<T>(
    context: DatabaseContext,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
}

export const PERSONAL_DATA_SCHEMAS = Object.freeze([
  "identity",
  "platform",
  "notifications",
  "market",
  "portfolio",
  "analytics",
  "alerts",
  "education",
] as const);
/** Never exported: a previous archive. Other binary columns become files in the archive. */
export const EXPORT_EXCLUDED_COLUMNS = Object.freeze(["identity.data_exports.content"]);
/** Datasets returned by `identity.export_auth_data()` (auth tables that reference the account). */
export const AUTH_EXPORT_DATASETS = Object.freeze([
  "users",
  "sessions",
  "accounts",
  "two_factors",
  "api_keys",
] as const);
/**
 * Columns outside `user_id` tables that may hold an account identifier (administrator actions on
 * global configuration). Erasure sets them to NULL in the system context; the catalog test
 * (packages/db integration, apps/api/integration/gdpr.mjs) fails when a new such column appears.
 */
export const ERASURE_REFERENCE_COLUMNS = Object.freeze([
  ["platform", "feature_flags", "updated_by"],
  ["platform", "role_limits", "updated_by"],
  ["market", "corporate_actions", "confirmed_by"],
  ["market", "calendar_events", "created_by"],
  ["market", "data_quality_issues", "resolved_by"],
  ["analytics", "stress_scenarios", "updated_by"],
] as const);
/** `erasure_log` and the file keep identifiers longer than the 35-day backup retention. */
export const ERASURE_LOG_DAYS = 40;

const SYSTEM: DatabaseContext = { userId: null, role: "system" };
const role = z.enum(["user", "pro", "admin"]);
const pseudonymSchema = z.string().regex(/^[0-9a-f]{64}$/u);
type Category = "integer" | "decimal" | "boolean" | "json" | "binary" | "timestamp" | "text";
export interface PersonalDataTable {
  readonly schema: string;
  readonly table: string;
  readonly columns: readonly { readonly name: string; readonly category: Category }[];
}

function category(type: string, typeCategory: string): Category {
  if (type === "int2" || type === "int4") return "integer";
  if (typeCategory === "N") return "decimal";
  if (type === "bool") return "boolean";
  if (type === "json" || type === "jsonb" || typeCategory === "A") return "json";
  if (type === "bytea") return "binary";
  if (type === "timestamptz") return "timestamp";
  return "text";
}

/** Tables with a `user_id` column in the application schemas (partitions excluded). */
export async function personalDataTables(tx: DatabaseTransaction): Promise<PersonalDataTable[]> {
  const rows = (
    await tx.execute(sql`SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
        t.typname AS type, t.typcategory AS category
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND n.nspname IN (${sql.join(
          PERSONAL_DATA_SCHEMAS.map((schema) => sql`${schema}`),
          sql`, `,
        )})
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute u
          WHERE u.attrelid = c.oid AND u.attname = 'user_id' AND NOT u.attisdropped)
      ORDER BY n.nspname, c.relname, a.attnum`)
  ).rows;
  const tables = new Map<
    string,
    { schema: string; table: string; columns: PersonalDataTable["columns"][number][] }
  >();
  for (const row of rows) {
    const schema = String(row.schema),
      table = String(row.table),
      column = String(row.column);
    if (EXPORT_EXCLUDED_COLUMNS.includes(`${schema}.${table}.${column}`)) continue;
    const key = `${schema}.${table}`;
    const entry = tables.get(key) ?? { schema, table, columns: [] };
    entry.columns.push({
      name: column,
      category: category(String(row.type), String(row.category)),
    });
    tables.set(key, entry);
  }
  return [...tables.values()];
}

function selectExpression(column: { name: string; category: Category }, index: number): SQL {
  const id = sql.identifier(column.name),
    alias = sql.identifier(`c${index}`);
  switch (column.category) {
    case "binary":
      return sql`${id} AS ${alias}`;
    case "json":
      return sql`to_jsonb(${id})::text AS ${alias}`;
    case "timestamp":
      return sql`to_char(${id} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${alias}`;
    default:
      return sql`${id}::text AS ${alias}`;
  }
}

function exportValue(value: unknown, kind: Category): ExportValue {
  if (value === null || value === undefined) return null;
  if (kind === "binary") return new Uint8Array(z.instanceof(Buffer).parse(value));
  const text = z.string().parse(value);
  if (kind === "boolean") return text === "true" || text === "t";
  if (kind === "integer" || kind === "json") return { raw: text };
  return text;
}

async function readTable(
  tx: DatabaseTransaction,
  table: PersonalDataTable,
  ownerColumn: string,
  userId: string,
): Promise<ExportDataset> {
  const rows = (
    await tx.execute(
      sql`SELECT ${sql.join(table.columns.map(selectExpression), sql`, `)}
        FROM ${sql.identifier(table.schema)}.${sql.identifier(table.table)}
        WHERE ${sql.identifier(ownerColumn)} = ${userId}::uuid ORDER BY 1`,
    )
  ).rows;
  return {
    name: `${table.schema}.${table.table}`,
    columns: table.columns.map((column) => column.name),
    rows: rows.map((row) =>
      table.columns.map((column, index) => exportValue(row[`c${index}`], column.category)),
    ),
  };
}

const AUDIT_EXPORT: PersonalDataTable = Object.freeze({
  schema: "platform",
  table: "audit_log",
  columns: Object.freeze([
    { name: "id", category: "text" },
    { name: "occurred_at", category: "timestamp" },
    { name: "actor_type", category: "text" },
    { name: "action", category: "text" },
    { name: "resource_type", category: "text" },
    { name: "resource_id", category: "text" },
    { name: "outcome", category: "text" },
    { name: "ip", category: "text" },
    { name: "user_agent", category: "text" },
    { name: "request_id", category: "text" },
    { name: "before", category: "json" },
    { name: "after", category: "json" },
  ] as const),
});

const authValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
function authDatasets(data: unknown): ExportDataset[] {
  const parsed = z
    .object(
      Object.fromEntries(
        AUTH_EXPORT_DATASETS.map((name) => [name, z.array(z.record(z.string(), authValue))]),
      ),
    )
    .strict()
    .parse(data);
  return AUTH_EXPORT_DATASETS.map((name) => {
    const rows = parsed[name] ?? [];
    const columns = Object.keys(rows[0] ?? {});
    return {
      name: `auth.${name}`,
      columns,
      rows: rows.map((row) =>
        columns.map((column): ExportValue => {
          const value = row[column] ?? null;
          return typeof value === "number" ? { raw: String(value) } : value;
        }),
      ),
    };
  });
}

/**
 * Reads every personal dataset of one account in a single transaction under its own RLS
 * context. The explicit owner filter is defence in depth; RLS already limits each table.
 */
export async function collectPersonalData(
  database: GdprDatabase,
  context: { userId: string; role: "user" | "pro" | "admin" },
): Promise<ExportDataset[]> {
  return database.transaction(context, async (tx) => {
    const auth = (await tx.execute(sql`SELECT identity.export_auth_data()::text AS data`)).rows[0];
    const datasets = authDatasets(JSON.parse(z.string().parse(auth?.data)));
    for (const table of await personalDataTables(tx))
      datasets.push(await readTable(tx, table, "user_id", context.userId));
    datasets.push(await readTable(tx, AUDIT_EXPORT, "actor_user_id", context.userId));
    return datasets;
  });
}

export type DataExportResult =
  | { status: "ready" | "failed"; userId: string; exportId: string }
  | { status: "skipped" };

/**
 * Worker side of `createDataExport`: claims a queued export, builds the archive and stores it for
 * 24 h (one download). Failures leave no content behind; nothing about the data reaches logs.
 */
export async function processDataExport(
  database: GdprDatabase,
  input: unknown,
  options: { readme: (locale: string) => string; now?: () => Date },
): Promise<DataExportResult> {
  const job = dataExportJobSchema.parse(input);
  const account = await database.transaction(SYSTEM, async (tx) => {
    const row = (
      await tx.execute(sql`SELECT role FROM identity.user_directory WHERE id = ${job.userId}::uuid`)
    ).rows[0];
    return row ? { userId: job.userId, role: role.parse(row.role) } : null;
  });
  if (!account) return { status: "skipped" };
  const claimed = await database.transaction(account, async (tx) => {
    const row = (
      await tx.execute(sql`UPDATE identity.data_exports SET status = 'running'
        WHERE id = ${job.exportId}::uuid AND user_id = ${job.userId}::uuid AND status = 'queued'
        RETURNING (SELECT locale FROM identity.user_preferences WHERE user_id = ${job.userId}::uuid) AS locale`)
    ).rows[0];
    return row ? { locale: typeof row.locale === "string" ? row.locale : "pl-PL" } : null;
  });
  if (!claimed) return { status: "skipped" };
  try {
    const datasets = await collectPersonalData(database, account);
    const archive = buildExportArchive({
      userId: job.userId,
      exportedAt: options.now?.() ?? new Date(),
      datasets,
      readme: options.readme(claimed.locale),
    });
    if (archive.length > EXPORT_MAX_BYTES) throw new Error("EXPORT_TOO_LARGE");
    const stored = await database.transaction(account, async (tx) =>
      tx.execute(sql`UPDATE identity.data_exports
        SET status = 'ready', content = ${Buffer.from(archive)}, size_bytes = ${archive.length},
          expires_at = now() + make_interval(hours => ${GDPR_LIMITS.exportAvailableHours})
        WHERE id = ${job.exportId}::uuid AND status = 'running'`),
    );
    if (!stored.rowCount) return { status: "skipped" };
    return { status: "ready", userId: job.userId, exportId: job.exportId };
  } catch {
    await database.transaction(account, (tx) =>
      tx.execute(sql`UPDATE identity.data_exports SET status = 'failed', content = NULL
        WHERE id = ${job.exportId}::uuid AND status = 'running'`),
    );
    return { status: "failed", userId: job.userId, exportId: job.exportId };
  }
}

export interface ErasureRecord {
  readonly erasedUserId: string;
  readonly erasedAt: string;
}

/**
 * Erases every account whose 14-day grace period has passed. `pseudonym` is the audit HMAC
 * (AUDIT_PSEUDONYM_KEY, kontrole-bezpieczenstwa.md § 1); its value for "system" identifies the
 * actor of the `identity.account_erased` audit entry.
 */
export async function eraseDueAccounts(
  database: GdprDatabase,
  pseudonym: (value: string) => string,
): Promise<ErasureRecord[]> {
  const accounts = await database.transaction(SYSTEM, async (tx) =>
    (
      await tx.execute(sql`SELECT id::text AS id, role FROM identity.user_directory ORDER BY id`)
    ).rows.map((row) => ({ userId: z.uuid().parse(row.id), role: role.parse(row.role) })),
  );
  const erased: ErasureRecord[] = [];
  for (const account of accounts) {
    const due = await database.transaction(account, async (tx) =>
      Boolean(
        (
          await tx.execute(sql`SELECT 1 FROM identity.deletion_requests
            WHERE user_id = ${account.userId}::uuid AND cancelled_at IS NULL AND completed_at IS NULL
              AND scheduled_for <= now() LIMIT 1`)
        ).rows[0],
      ),
    );
    if (!due) continue;
    const ref = pseudonymSchema.parse(pseudonym(account.userId));
    const record = await database.transaction(SYSTEM, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`erasure:${account.userId}`}, 114))`,
      );
      const done = (
        await tx.execute(
          sql`SELECT identity.erase_account(${account.userId}::uuid, ${ref}) AS erased`,
        )
      ).rows[0];
      if (done?.erased !== true) return null;
      for (const [schema, table, column] of ERASURE_REFERENCE_COLUMNS)
        await tx.execute(
          sql`UPDATE ${sql.identifier(schema)}.${sql.identifier(table)} SET ${sql.identifier(column)} = NULL
            WHERE ${sql.identifier(column)} = ${account.userId}::uuid`,
        );
      await tx.execute(sql`UPDATE platform.feature_flags
        SET rules = jsonb_set(rules, '{users}', (rules -> 'users') - ${account.userId}::text)
        WHERE jsonb_typeof(rules -> 'users') = 'array' AND (rules -> 'users') ? ${account.userId}::text`);
      await tx.execute(sql`INSERT INTO platform.audit_log
        (actor_user_id, actor_ref, actor_type, action, resource_type, resource_id, outcome)
        VALUES (NULL, ${pseudonymSchema.parse(pseudonym("system"))}, 'system', 'identity.account_erased',
          'user', ${ref}, 'success')`);
      const row = (
        await tx.execute(sql`SELECT to_char(erased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
          FROM platform.erasure_log WHERE erased_user_id = ${account.userId}::uuid`)
      ).rows[0];
      return { erasedUserId: account.userId, erasedAt: z.string().parse(row?.at) };
    });
    if (record) erased.push(record);
  }
  return erased;
}

const fileLine = z
  .object({ erased_user_id: z.uuid(), erased_at: z.iso.datetime({ offset: true }) })
  .strict();

/**
 * Makes `erasure-log.jsonl` (backup disk, copied off-site hourly) hold every identifier still in
 * `platform.erasure_log` and nothing older than 40 days. The table is the source of truth for that
 * window, so a crash between the database commit and the file write heals on the next run. Lines
 * are only appended unless something must be purged; then the file is rewritten in place (it is a
 * bind-mounted single file, so no rename). Damaged lines are counted and kept verbatim for review.
 * `unrecorded` lists identifiers the file holds but the table does not: after a backup restore
 * these accounts must be erased again (`reEraseRestoredAccounts`).
 */
export async function syncErasureFile(
  database: GdprDatabase,
  path: string,
  now: Date = new Date(),
): Promise<{ appended: number; removed: number; invalid: number; unrecorded: string[] }> {
  if (!isAbsolute(path)) throw new Error("ERASURE_FILE_PATH_INVALID");
  const recorded = await database.transaction(SYSTEM, async (tx) =>
    (
      await tx.execute(sql`SELECT erased_user_id::text AS id,
          to_char(erased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM platform.erasure_log ORDER BY erased_at, erased_user_id`)
    ).rows.map((row) => ({
      erased_user_id: z.uuid().parse(row.id),
      erased_at: z.string().parse(row.at),
    })),
  );
  // r+ never creates the file: a missing bind mount must fail loudly, not write elsewhere.
  const handle = await open(path, "r+");
  try {
    const text = await handle.readFile("utf8");
    const cutoff = now.getTime() - ERASURE_LOG_DAYS * 86_400_000;
    let removed = 0;
    const damaged: string[] = [];
    const kept = new Map<string, z.infer<typeof fileLine>>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let parsed: z.infer<typeof fileLine>;
      try {
        parsed = fileLine.parse(JSON.parse(line));
      } catch {
        damaged.push(line.replace(/\r$/u, ""));
        continue;
      }
      if (Date.parse(parsed.erased_at) < cutoff) removed += 1;
      else kept.set(parsed.erased_user_id, parsed);
    }
    const missing = recorded.filter((entry) => !kept.has(entry.erased_user_id));
    const serialize = (entries: readonly z.infer<typeof fileLine>[]) =>
      entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
    if (removed) {
      const content =
        damaged
          .map(
            (line) => `${line}
`,
          )
          .join("") + serialize([...kept.values(), ...missing]);
      await handle.truncate(0);
      await handle.write(content, 0, "utf8");
    } else if (missing.length) {
      const prefix = text.length && !text.endsWith("\n") ? "\n" : "";
      await handle.write(prefix + serialize(missing), Buffer.byteLength(text), "utf8");
    }
    await handle.sync();
    const known = new Set(recorded.map((entry) => entry.erased_user_id));
    return {
      appended: missing.length,
      removed,
      invalid: damaged.length,
      unrecorded: [...kept.keys()].filter((id) => !known.has(id)),
    };
  } finally {
    await handle.close();
  }
}

/**
 * Restore safety net (backup-dr.md § 7): an account listed in the file that exists again after a
 * restore gets a due deletion request, so the same run erases it before users are let in.
 * Returns how many accounts were scheduled.
 */
export async function reEraseRestoredAccounts(
  database: GdprDatabase,
  userIds: readonly string[],
): Promise<number> {
  let scheduled = 0;
  for (const id of userIds) {
    const userId = z.uuid().parse(id);
    const account = await database.transaction(SYSTEM, async (tx) => {
      const row = (
        await tx.execute(sql`SELECT role FROM identity.user_directory WHERE id = ${userId}::uuid`)
      ).rows[0];
      return row ? { userId, role: role.parse(row.role) } : null;
    });
    if (!account) continue;
    await database.transaction(account, async (tx) => {
      const updated = await tx.execute(sql`UPDATE identity.deletion_requests
        SET scheduled_for = now(), cancelled_at = NULL
        WHERE user_id = ${userId}::uuid AND completed_at IS NULL`);
      if (!updated.rowCount)
        await tx.execute(sql`INSERT INTO identity.deletion_requests (user_id, scheduled_for)
          VALUES (${userId}::uuid, now())`);
    });
    scheduled += 1;
  }
  return scheduled;
}
