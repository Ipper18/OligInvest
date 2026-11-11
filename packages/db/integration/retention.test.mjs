import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAppDatabase, createAuthDatabase } from "../src/index.ts";
import { auditPartitioningDue, RETENTION_TARGETS, runRetention } from "../src/retention.ts";

// Synthetic fixtures only. Periods: prywatnosc-rodo.md § 6; quota boundary: R-52 (7 × 24 h).
const owner = randomUUID();
const other = randomUUID();
const admin = randomUUID();
let app, auth;
const ids = {};
const user = (userId) => ({ userId, role: "user" });
const SYSTEM = { userId: null, role: "system" };

async function seed() {
  ids.files = { expired: [], kept: [] };
  ids.exports = {};
  ids.deliveries = { old: [], kept: [] };
  ids.quota = { old: [], kept: [] };
  for (const userId of [owner, other]) {
    await app.transaction(user(userId), async (tx) => {
      const account = (
        await tx.execute(sql`INSERT INTO portfolio.accounts (user_id, name, broker, currency)
          VALUES (${userId}, ${`retention ${randomUUID()}`}, 'demo', 'PLN') RETURNING id::text`)
      ).rows[0].id;
      for (const [kind, expires] of [
        ["expired", "-1 minute"],
        ["expired", "-90 days"],
        ["expired", "-1 second"],
        ["kept", "1 hour"],
      ]) {
        const batch = (
          await tx.execute(sql`INSERT INTO portfolio.import_batches
            (user_id, account_id, source, file_name, file_sha256)
            VALUES (${userId}, ${account}, 'generic', 'synthetic.csv', ${randomUUID()}) RETURNING id::text`)
        ).rows[0].id;
        await tx.execute(sql`INSERT INTO portfolio.import_files
          (batch_id, user_id, content, content_type, size_bytes, expires_at)
          VALUES (${batch}, ${userId}, '\\x00'::bytea, 'text/csv', 1, now() + ${expires}::interval)`);
        ids.files[kind].push(batch);
      }
      for (const [kind, age] of [
        ["old", "180 days 1 minute"],
        ["old", "400 days"],
        ["kept", "179 days 23 hours"],
      ]) {
        const id = (
          await tx.execute(sql`INSERT INTO notifications.notification_deliveries
            (user_id, kind, channel, status, created_at)
            VALUES (${userId}, 'system', 'email', 'sent', now() - ${age}::interval) RETURNING id::text`)
        ).rows[0].id;
        ids.deliveries[kind].push(id);
      }
      for (const [kind, age] of [
        ["old", "168 hours 1 minute"],
        ["old", "30 days"],
        ["kept", "167 hours 50 minutes"],
        ["kept", "0 hours"],
      ]) {
        const id = randomUUID();
        await tx.execute(sql`INSERT INTO platform.role_quota_usage
          (operation_id, user_id, quota_key, consumed_at)
          VALUES (${id}, ${userId}, 'analytics_heavy_per_day', now() - ${age}::interval)`);
        ids.quota[kind].push(id);
      }
    });
  }
  await app.transaction(user(owner), async (tx) => {
    const insert = async (key, status, created, expires, downloaded) => {
      ids.exports[key] = (
        await tx.execute(sql`INSERT INTO identity.data_exports
          (user_id, status, content, size_bytes, created_at, expires_at, downloaded_at)
          VALUES (${owner}, ${status}, ${status === "ready" || status === "failed" ? sql`'\\x00'::bytea` : sql`NULL`}, 1,
            now() - ${created}::interval, ${expires === null ? null : sql`now() + ${expires}::interval`},
            ${downloaded ? sql`now() - interval '1 minute'` : null}) RETURNING id::text`)
      ).rows[0].id;
    };
    await insert("expired", "ready", "25 hours", "-1 hour", false);
    await insert("downloaded", "ready", "1 hour", "23 hours", true);
    await insert("fresh", "ready", "1 hour", "23 hours", false);
    await insert("legacy", "ready", "25 hours", null, false);
    await insert("failed", "failed", "1 hour", null, false);
    await insert("queued", "queued", "30 hours", null, false);
  });
  ids.invitations = {};
  await app.transaction({ userId: admin, role: "admin" }, async (tx) => {
    for (const [key, expires, used] of [
      ["stale", "30 days 1 minute", false],
      ["fresh", "29 days 23 hours", false],
      ["used", "90 days", true],
    ])
      ids.invitations[key] = (
        await tx.execute(sql`INSERT INTO identity.invitations
          (email, role, token_hash, invited_by, expires_at, used_at, used_by)
          VALUES (${`${key}-${randomUUID()}@example.test`}, 'user', ${randomUUID()}, ${admin},
            now() - ${expires}::interval, ${used ? sql`now() - interval '91 days'` : null},
            ${used ? owner : null}) RETURNING id::text`)
      ).rows[0].id;
  });
  ids.vitals = {};
  await app.transaction(SYSTEM, async (tx) => {
    for (const [key, age] of [
      ["old", "90 days 1 minute"],
      ["kept", "89 days 23 hours"],
    ])
      ids.vitals[key] = (
        await tx.execute(sql`INSERT INTO platform.web_vitals (recorded_at, route, metric, value)
          VALUES (now() - ${age}::interval, '/portfel', 'LCP', 1200) RETURNING id::text`)
      ).rows[0].id;
  });
}

async function remaining(context, query) {
  return (await app.transaction(context, async (tx) => (await tx.execute(query)).rows)).map(
    (row) => row.id,
  );
}

beforeAll(async () => {
  const { passwords, ...base } = JSON.parse(process.env.OLIGINVEST_TEST_DATABASE);
  app = createAppDatabase({ ...base, password: passwords.app, max: 4 });
  auth = createAuthDatabase({ ...base, password: passwords.auth, max: 1 });
  await auth.transaction(async (tx) => {
    for (const [id, role] of [
      [owner, "user"],
      [other, "pro"],
      [admin, "admin"],
    ])
      await tx.execute(sql`INSERT INTO auth.users (id, name, email, role)
        VALUES (${id}, 'Retention fixture', ${`${id}@example.test`}, ${role})`);
  });
});

afterAll(async () => {
  // invitations.invited_by/used_by have no ON DELETE action, so they go first.
  await app?.transaction({ userId: admin, role: "admin" }, (tx) =>
    tx.execute(sql`DELETE FROM identity.invitations WHERE invited_by = ${admin}`),
  );
  await auth?.transaction((tx) =>
    tx.execute(sql`DELETE FROM auth.users WHERE id IN (${owner}, ${other}, ${admin})`),
  );
  await Promise.all([app?.close(), auth?.close()]);
});

test("retention deletes only rows past each documented period, in batches, under RLS", async () => {
  await seed();
  const results = await runRetention(app, { batchSize: 2 });
  expect(results.map((r) => r.target)).toEqual(RETENTION_TARGETS.map((t) => t.id));
  expect(results.every((r) => !r.skipped)).toBe(true);
  const rows = Object.fromEntries(results.map((r) => [r.target, r.rows]));
  // >= because other suites may leave eligible rows; exact fixture state is asserted below.
  expect(rows.import_files).toBeGreaterThanOrEqual(6);
  expect(rows.notification_deliveries).toBeGreaterThanOrEqual(4);
  expect(rows.role_quota_usage).toBeGreaterThanOrEqual(4);

  for (const userId of [owner, other]) {
    const files = await remaining(
      user(userId),
      sql`SELECT batch_id::text AS id FROM portfolio.import_files`,
    );
    expect(files.every((id) => ids.files.kept.includes(id))).toBe(true);
    expect(files).toHaveLength(1);
    // Import batches (metadata) stay; only the raw file is removed.
    const batches = await remaining(
      user(userId),
      sql`SELECT id::text AS id FROM portfolio.import_batches`,
    );
    expect(batches.length).toBeGreaterThanOrEqual(4);
    const deliveries = await remaining(
      user(userId),
      sql`SELECT id::text AS id FROM notifications.notification_deliveries`,
    );
    expect(deliveries).toHaveLength(1);
    expect(ids.deliveries.kept).toContain(deliveries[0]);
    const quota = await remaining(
      user(userId),
      sql`SELECT operation_id::text AS id FROM platform.role_quota_usage ORDER BY consumed_at`,
    );
    expect(quota).toHaveLength(2);
    expect(quota.every((id) => ids.quota.kept.includes(id))).toBe(true);
  }

  const exports = Object.fromEntries(
    (
      await app.transaction(
        user(owner),
        async (tx) =>
          (
            await tx.execute(sql`SELECT id::text, status, content IS NOT NULL AS has_content,
            size_bytes::text FROM identity.data_exports`)
          ).rows,
      )
    ).map((row) => [Object.keys(ids.exports).find((k) => ids.exports[k] === row.id), row]),
  );
  expect(exports.expired).toMatchObject({ status: "expired", has_content: false, size_bytes: "1" });
  expect(exports.downloaded).toMatchObject({ status: "expired", has_content: false });
  expect(exports.legacy).toMatchObject({ status: "expired", has_content: false });
  expect(exports.failed).toMatchObject({ status: "failed", has_content: false });
  expect(exports.fresh).toMatchObject({ status: "ready", has_content: true });
  expect(exports.queued).toMatchObject({ status: "queued", has_content: false });

  const invitations = await remaining(
    { userId: admin, role: "admin" },
    sql`SELECT id::text AS id FROM identity.invitations WHERE invited_by = ${admin}`,
  );
  expect(invitations.sort()).toEqual([ids.invitations.fresh, ids.invitations.used].sort());
  const vitals = await remaining(
    SYSTEM,
    sql`SELECT id::text AS id FROM platform.web_vitals WHERE id IN (${ids.vitals.old}, ${ids.vitals.kept})`,
  );
  expect(vitals).toEqual([ids.vitals.kept]);

  // Idempotent: a second run finds nothing left.
  expect((await runRetention(app)).every((r) => r.rows === 0 && !r.skipped)).toBe(true);
});

test("concurrent runs never double-delete and a held target lock is skipped, not awaited", async () => {
  await seed();
  const [first, second] = await Promise.all([
    runRetention(app, { batchSize: 1 }),
    runRetention(app, { batchSize: 1 }),
  ]);
  const total = (target) =>
    first.find((r) => r.target === target).rows + second.find((r) => r.target === target).rows;
  expect(total("import_files")).toBe(6);
  expect(total("role_quota_usage")).toBe(4);
  expect(total("notification_deliveries")).toBe(4);
  expect(total("invitations")).toBe(1);
  expect(total("web_vitals")).toBe(1);

  await seed();
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let locked;
  const ready = new Promise((resolve) => {
    locked = resolve;
  });
  const holder = app.transaction(SYSTEM, async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`retention:role_quota_usage:${owner}`}, 115))`,
    );
    locked();
    await held;
  });
  await ready;
  try {
    const blocked = await runRetention(app);
    const quota = blocked.find((r) => r.target === "role_quota_usage");
    // Only the owner's entries wait for the lock holder; the other user's are removed.
    expect(quota).toMatchObject({ rows: 2, skipped: true });
    expect(blocked.find((r) => r.target === "import_files")).toMatchObject({ skipped: false });
  } finally {
    release();
    await holder;
  }
  const after = await runRetention(app);
  expect(after.find((r) => r.target === "role_quota_usage")).toMatchObject({
    rows: 2,
    skipped: false,
  });
});

test("audit partitioning is an extension point that never deletes audit rows", async () => {
  const audit = await auditPartitioningDue(app);
  expect(audit.estimate).toBeGreaterThanOrEqual(0);
  expect(audit.due).toBe(audit.estimate > 1_000_000);
  await expect(
    app.transaction(SYSTEM, (tx) => tx.execute(sql`DELETE FROM platform.audit_log`)),
  ).rejects.toThrow();
});
