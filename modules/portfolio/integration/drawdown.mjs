import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { loadTestVectors, readStatistic } from "../../../packages/test-vectors/dist/index.js";

export async function testDrawdown({ request, database, owner }) {
  const id = randomUUID(),
    empty = randomUUID();
  const C = loadTestVectors().C_drawdown;
  await database.transaction(owner, async (tx) => {
    for (const account of [id, empty])
      await tx.execute(
        sql`INSERT INTO portfolio.accounts(id,user_id,name,broker,account_type,currency) VALUES(${account}::uuid,${owner.userId}::uuid,${`Synthetic drawdown ${account}`},'other','regular','PLN')`,
      );
    for (const [i, v] of C.values.entries()) {
      const date = `2025-01-${String(i + 1).padStart(2, "0")}`,
        value = String(readStatistic(v));
      await tx.execute(
        sql`INSERT INTO portfolio.valuations_daily(user_id,account_id,valuation_date,market_value,cash,total_value,total_value_pln,external_flow,external_flow_pln,as_of,is_complete) VALUES(${owner.userId}::uuid,${id}::uuid,${date}::date,0,${value}::numeric,${value}::numeric,${value}::numeric,${i ? "0" : value}::numeric,${i ? "0" : value}::numeric,${`${date}T20:00:00Z`}::timestamptz,true)`,
      );
    }
  });
  const get = async (query = `accountId=${id}&to=2025-01-08`) => {
    const response = await request(`drawdown?${query}`);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const result = await get();
  assert.equal(result.maxDrawdown, "-0.25");
  assert.equal(result.peakDate, "2025-01-04");
  assert.equal(result.durationDays, 1);
  assert.equal(result.recoveryDays, 2);
  assert.equal(result.underwater.drawdown.length, C.values.length);
  const foreign = await request(`drawdown?accountId=${id}`, "GET", undefined, { "x-owner": "b" });
  assert.equal(foreign.status, 404, "PostgreSQL RLS hides a foreign account even from admin");
  assert.equal((await foreign.json()).code, "NOT_FOUND");
  assert.equal((await get(`accountId=${empty}`)).maxDrawdown, null);
  for (const query of [
    "maxPoints=49",
    "maxPoints=3001",
    "to=2099-01-01",
    "from=2025-02-01&to=2025-01-01",
    "unknown=1",
    "from=2025-01-01&from=2025-01-02",
  ])
    assert.equal((await request(`drawdown?${query}`)).status, 422, query);
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`UPDATE portfolio.valuations_daily SET is_complete=false,total_value_pln=NULL WHERE account_id=${id}::uuid AND valuation_date='2025-01-03'`,
    );
  });
  assert.equal((await get()).status, "incomplete");
  assert.equal((await get()).maxDrawdown, null);
}
