import { readFile } from "node:fs/promises";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, test } from "vitest";
import { RETENTION_TARGETS, runRetention } from "../src/retention.ts";

const dialect = new PgDialect();
const text = (query) => dialect.sqlToQuery(query).sql.replace(/\s+/gu, " ");
const users = ["0198a000-0000-7000-8000-00000000000a", "0198a000-0000-7000-8000-00000000000b"];

/** Fake pool: scripted row counts per target, optional lock refusals, recorded contexts. */
function fakeDatabase({ rows = {}, refuse = new Set() } = {}) {
  const calls = [];
  let pendingLock;
  return {
    calls,
    async transaction(context, work) {
      return work({
        async execute(query) {
          const sql = text(query);
          if (sql.includes("identity.user_directory")) return { rows: users.map((id) => ({ id })) };
          if (sql.includes("pg_try_advisory_xact_lock")) {
            pendingLock = dialect.sqlToQuery(query).params[0];
            return { rows: [{ acquired: !refuse.has(pendingLock) }] };
          }
          const target = RETENTION_TARGETS.find(
            (t) => text(t.batch(1)).split("$")[0] === sql.split("$")[0],
          );
          if (!target) throw new Error(`Unexpected SQL: ${sql}`);
          calls.push({ target: target.id, context, lock: pendingLock });
          const queue = rows[`${target.id}:${context.userId ?? "system"}`] ?? [];
          return { rowCount: queue.shift() ?? 0, rows: [] };
        },
      });
    },
  };
}

test("every retention period matches the documented NFR-11.02 table", async () => {
  const doc = await readFile(
    new URL("../../../docs/06-bezpieczenstwo/prywatnosc-rodo.md", import.meta.url),
    "utf8",
  );
  for (const row of [
    "| Pliki importu | 90 dni |",
    "| Archiwa eksportu RODO | 24 h lub do pierwszego pobrania |",
    "| Zaproszenia niewykorzystane | 30 dni po wygaśnięciu |",
    "| Dziennik doręczeń powiadomień | 180 dni |",
    "| Pomiary RUM | 90 dni |",
    "| `platform.role_quota_usage` | wpisy starsze niż 7 × 24 h",
  ])
    expect(doc).toContain(row);
  const sqlOf = Object.fromEntries(RETENTION_TARGETS.map((t) => [t.id, text(t.batch(1))]));
  expect(sqlOf.import_files).toContain("expires_at <= now()");
  expect(sqlOf.data_exports).toContain("interval '24 hours'");
  expect(sqlOf.data_exports).toContain("downloaded_at IS NOT NULL");
  expect(sqlOf.invitations).toContain(
    "used_at IS NULL AND expires_at < now() - interval '30 days'",
  );
  expect(sqlOf.notification_deliveries).toContain("interval '180 days'");
  expect(sqlOf.web_vitals).toContain("interval '90 days'");
  expect(sqlOf.role_quota_usage).toContain("interval '168 hours'");
  // Exports keep their metadata row; only the archive is cleared.
  expect(sqlOf.data_exports).toMatch(/^UPDATE identity\.data_exports SET content = NULL/u);
  for (const sql of Object.values(sqlOf)) expect(sql).toMatch(/LIMIT \$1\)$/u);
});

test("user rows run in each owner's RLS context, global rows in the system context", async () => {
  const database = fakeDatabase();
  await runRetention(database);
  const scopes = Object.groupBy(database.calls, (call) => call.target);
  for (const id of ["import_files", "data_exports", "notification_deliveries", "role_quota_usage"])
    expect(scopes[id].map((call) => call.context)).toEqual(
      users.map((userId) => ({ userId, role: "user" })),
    );
  for (const id of ["invitations", "web_vitals"])
    expect(scopes[id].map((call) => call.context)).toEqual([{ userId: null, role: "system" }]);
  expect(scopes.role_quota_usage[1].lock).toBe(`retention:role_quota_usage:${users[1]}`);
});

test("batches repeat until a short batch and a held lock skips only that owner", async () => {
  const database = fakeDatabase({
    rows: { [`import_files:${users[0]}`]: [2, 2, 1], "web_vitals:system": [2, 0] },
    refuse: new Set([`retention:role_quota_usage:${users[0]}`]),
  });
  const results = Object.fromEntries(
    (await runRetention(database, { batchSize: 2 })).map((r) => [r.target, r]),
  );
  expect(results.import_files).toEqual({ target: "import_files", rows: 5, skipped: false });
  expect(results.web_vitals.rows).toBe(2);
  expect(results.role_quota_usage).toEqual({ target: "role_quota_usage", rows: 0, skipped: true });
  expect(
    database.calls.filter((c) => c.target === "role_quota_usage").map((c) => c.context.userId),
  ).toEqual([users[1]]);
  await expect(runRetention(database, { batchSize: 0 })).rejects.toThrow();
});
