import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { OnboardingRepository } from "../dist/src/server/index.js";
export async function testOnboardingStorage(settings) {
  const options = { host: settings.host, port: settings.port, database: settings.database };
  const db = createAppDatabase({ ...options, password: settings.passwords.app }),
    auth = createAuthDatabase({ ...options, password: settings.passwords.auth });
  const owner = { userId: randomUUID(), role: "user" },
    other = { userId: randomUUID(), role: "admin" };
  try {
    await auth.transaction(async (tx) => {
      for (const user of [owner, other])
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email) VALUES(${user.userId}::uuid,'Synthetic onboarding',${`${user.userId}@example.invalid`})`,
        );
    });
    const repo = new OnboardingRepository(db);
    assert.equal((await repo.read(owner)).step, "start");
    await repo.update(owner, { action: "advance", step: "import" });
    assert.equal((await repo.read(owner)).step, "import");
    assert.equal((await repo.read(other)).step, "start");
    const skipped = await repo.update(owner, { action: "skip" });
    assert.ok(skipped.skippedAt);
    assert.equal((await repo.update(owner, { action: "skip" })).skippedAt, skipped.skippedAt);
    const restarted = await repo.update(owner, { action: "restart" });
    assert.equal(restarted.skippedAt, undefined);
    assert.equal(restarted.step, "start");
    const completed = await repo.update(owner, { action: "complete", step: "footer" });
    assert.ok(completed.completedAt);
    assert.equal(
      (await repo.update(owner, { action: "complete" })).completedAt,
      completed.completedAt,
    );
    const foreignRows = await db.transaction(other, (tx) =>
      tx.execute(sql`SELECT * FROM education.onboarding_state WHERE user_id=${owner.userId}::uuid`),
    );
    assert.equal(foreignRows.rows.length, 0);
    await assert.rejects(repo.update(owner, { action: "advance", step: "INVALID!" }));
    await assert.rejects(repo.update(owner, { action: "skip", userId: other.userId }));
  } finally {
    await auth.transaction(async (tx) => {
      for (const user of [owner, other])
        await tx.execute(sql`DELETE FROM auth.users WHERE id=${user.userId}::uuid`);
    });
    await db.close();
    await auth.close();
  }
}
