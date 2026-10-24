import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { MarketRepository, WatchlistRepository } from "../dist/src/server/index.js";

export async function testWatchlistStorage(settings) {
  const options = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAppDatabase({ ...options, password: settings.passwords.app });
  const auth = createAuthDatabase({ ...options, password: settings.passwords.auth });
  const owner = { userId: randomUUID(), role: "user" };
  const other = { userId: randomUUID(), role: "admin" };
  const ids = Array.from({ length: 50 }, () => randomUUID());
  const repo = new WatchlistRepository(new MarketRepository(database));
  try {
    await auth.transaction(async (tx) => {
      for (const user of [owner, other])
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email) VALUES(${user.userId}::uuid,'Synthetic watchlist',${`${user.userId}@example.invalid`})`,
        );
    });
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      for (const [index, id] of ids.entries())
        await tx.execute(
          sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${id}::uuid,'XWAR',${`SYN${index}`},'Synthetic watchlist instrument','stock','PLN')`,
        );
    });
    const key = randomUUID();
    const first = await repo.create(owner, { name: "Synthetic 0" }, key);
    assert.equal((await repo.create(owner, { name: "Synthetic 0" }, key)).replayed, true);
    await assert.rejects(repo.create(owner, { name: "Different" }, key), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    const lists = [first.value];
    for (let i = 1; i < 3; i++)
      lists.push((await repo.create(owner, { name: `Synthetic ${i}` })).value);
    for (const list of lists)
      for (const instrumentId of ids) await repo.addItem(owner, list.id, { instrumentId });
    assert.deepEqual(
      (await repo.list(owner)).data.map((list) => list.itemCount),
      [50, 50, 50],
    );
    assert.equal((await repo.list(other)).data.length, 0);
    await assert.rejects(repo.detail(other, first.value.id), { code: "NOT_FOUND" });
    await assert.rejects(repo.update(other, first.value.id, { name: "Denied" }), {
      code: "NOT_FOUND",
    });
    await assert.rejects(repo.removeItem(other, first.value.id, ids[0]), { code: "NOT_FOUND" });
    await repo.updateItem(owner, first.value.id, ids[49], {
      position: 0,
      note: "Notatka syntetyczna",
    });
    const detail = await repo.detail(owner, first.value.id);
    assert.equal(detail.items[0].instrument.id, ids[49]);
    assert.equal(detail.items[0].note, "Notatka syntetyczna");
    assert.deepEqual(
      detail.items.map((item) => item.position),
      Array.from({ length: 50 }, (_, i) => i),
    );
    await repo.updateItem(owner, first.value.id, ids[49], { note: null });
    assert.equal((await repo.detail(owner, first.value.id)).items[0].note, undefined);
    await repo.update(owner, lists[2].id, { position: 0 });
    assert.equal((await repo.list(owner)).data[0].id, lists[2].id);
    await repo.removeItem(owner, first.value.id, ids[49]);
    const itemKey = randomUUID();
    await repo.addItem(owner, first.value.id, { instrumentId: ids[49] }, itemKey);
    assert.equal(
      (await repo.addItem(owner, first.value.id, { instrumentId: ids[49] }, itemKey)).replayed,
      true,
    );
    await repo.remove(owner, first.value.id);
    await assert.rejects(repo.detail(owner, first.value.id), { code: "NOT_FOUND" });
  } finally {
    await auth.transaction(async (tx) => {
      for (const user of [owner, other])
        await tx.execute(sql`DELETE FROM auth.users WHERE id=${user.userId}::uuid`);
    });
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(sql`DELETE FROM market.instruments WHERE id=ANY(${sql.param(ids)}::uuid[])`);
    });
    await database.close();
    await auth.close();
  }
}
