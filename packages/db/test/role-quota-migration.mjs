import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Exercise upgrade/backfill as the production migration role; roll back the fixture and DDL. */
export async function testRoleQuotaMigration(client) {
  const migration = await readFile(
    new URL("../migrations/0010_role-quota-usage.sql", import.meta.url),
    "utf8",
  );
  const userId = randomUUID();
  const acceptedId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query("DROP TABLE platform.role_quota_usage");
    await client.query(
      "INSERT INTO auth.users(id,name,email) VALUES($1,'Synthetic quota migration',$2)",
      [userId, `${userId}@example.invalid`],
    );
    for (const [id, type, age] of [
      [acceptedId, "goal", "0 hours"],
      [randomUUID(), "monte_carlo", "192 hours"],
      [randomUUID(), "what_if", "0 hours"],
    ])
      await client.query(
        `INSERT INTO analytics.analytics_runs(id,user_id,type,status,params,input_snapshot,algorithm_version,created_at)
       VALUES($1,$2,$3,'cancelled','{}','{}','synthetic',now()-$4::interval)`,
        [id, userId, type, age],
      );
    await client.query("SET LOCAL ROLE oliginvest_owner");
    await client.query(migration);
    await client.query("RESET ROLE");
    const rows = await client.query(
      "SELECT operation_id,quota_key FROM platform.role_quota_usage WHERE user_id=$1",
      [userId],
    );
    assert.deepEqual(rows.rows, [
      { operation_id: acceptedId, quota_key: "analytics_heavy_per_day" },
    ]);
    await client.query("DELETE FROM analytics.analytics_runs WHERE id=$1", [acceptedId]);
    assert.equal(
      (
        await client.query("SELECT 1 FROM platform.role_quota_usage WHERE operation_id=$1", [
          acceptedId,
        ])
      ).rowCount,
      1,
    );
    await client.query("DELETE FROM auth.users WHERE id=$1", [userId]);
    assert.equal(
      (await client.query("SELECT 1 FROM platform.role_quota_usage WHERE user_id=$1", [userId]))
        .rowCount,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
  }
}
