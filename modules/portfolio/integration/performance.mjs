import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

export async function testPerformance({ request, database, owner }) {
  const id = randomUUID();
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO portfolio.accounts(id,user_id,name,broker,account_type,currency) VALUES(${id}::uuid,${owner.userId}::uuid,'Synthetic performance','other','regular','USD')`,
    );
    await tx.execute(sql`INSERT INTO portfolio.valuations_daily(user_id,account_id,valuation_date,market_value,cash,total_value,total_value_pln,external_flow,external_flow_pln,fx_rate_to_pln,as_of,is_complete)
      SELECT ${owner.userId}::uuid,${id}::uuid,d::date,0,v,v,v*4,f,f*4,4,d,true FROM (
        SELECT d,CASE WHEN d<'2025-03-31' THEN 10000 WHEN d<'2025-04-01' THEN 10800 WHEN d<'2025-06-30' THEN 15800 WHEN d<'2025-07-01' THEN 15200 WHEN d<'2025-12-31' THEN 13200 ELSE 14100 END AS v,
        CASE WHEN d='2025-01-01' THEN 10000 WHEN d='2025-04-01' THEN 5000 WHEN d='2025-07-01' THEN -2000 ELSE 0 END AS f
        FROM generate_series('2025-01-01'::date,'2025-12-31'::date,'1 day') d) series`);
  });
  const get = async (query) => {
    const response = await request(`performance?accountId=${id}&${query}`);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const b = await get("to=2025-12-31&currency=account");
  assert.equal(b.currency, "USD");
  assert.equal(typeof b.total.twr, "string");
  assert(Math.abs(Number(b.total.twr) - 0.10982739) < 5e-9);
  assert(Math.abs(Number(b.total.xirr) - 0.08658843) < 1e-6);
  assert.equal((await get("to=2025-12-31")).currency, "PLN");
  assert.equal((await get("to=2025-01-30")).total.xirrStatus, "period_too_short");
  assert.equal((await get("to=2025-01-31")).total.xirrStatus, "ok");
  const foreign = await request(`performance?accountId=${id}`, "GET", undefined, {
    "x-owner": "b",
  });
  assert.equal(foreign.status, 404, "real PostgreSQL RLS also hides the account from an admin");
  assert.equal((await foreign.json()).code, "NOT_FOUND");
  for (const query of [
    "from=2025-04-01&to=2025-03-01",
    "to=2099-01-01",
    "currency=EUR",
    `instrumentId=${id}`,
    `benchmarkId=${id}`,
    "unexpected=true",
    "from=2025-01-01&from=2025-02-01",
  ]) {
    assert.equal((await request(`performance?accountId=${id}&${query}`)).status, 422, query);
  }
  assert.equal((await request("performance?currency=account")).status, 422);
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`UPDATE portfolio.valuations_daily SET total_value_pln=NULL,is_complete=false WHERE account_id=${id}::uuid AND valuation_date='2025-06-01'`,
    );
  });
  assert.equal((await get("to=2025-12-31")).total.twr, null);
  assert.equal((await get("to=2025-12-31")).total.xirr, null);
  // A transfer in transit is internal to the selected portfolio, including a future second leg.
  const source = randomUUID(),
    target = randomUUID(),
    outgoing = randomUUID();
  await database.transaction(owner, async (tx) => {
    for (const account of [source, target])
      await tx.execute(
        sql`INSERT INTO portfolio.accounts(id,user_id,name,broker,account_type,currency) VALUES(${account}::uuid,${owner.userId}::uuid,${`Synthetic transfer ${account}`},'other','regular','PLN')`,
      );
    await tx.execute(
      sql`INSERT INTO portfolio.transactions(user_id,account_id,type,trade_date,amount,cash_currency,source) VALUES(${owner.userId}::uuid,${source}::uuid,'DEPOSIT','2025-01-01',1000,'PLN','manual')`,
    );
    await tx.execute(
      sql`INSERT INTO portfolio.transactions(id,user_id,account_id,type,trade_date,amount,cash_currency,source) VALUES(${outgoing}::uuid,${owner.userId}::uuid,${source}::uuid,'CASH_TRANSFER_OUT','2025-01-02',-500,'PLN','manual')`,
    );
    await tx.execute(
      sql`INSERT INTO portfolio.transactions(user_id,account_id,type,trade_date,amount,cash_currency,source,related_transaction_id) VALUES(${owner.userId}::uuid,${target}::uuid,'CASH_TRANSFER_IN','2025-01-03',500,'PLN','manual',${outgoing}::uuid)`,
    );
    for (const [account, day, value, flow] of [
      [source, "2025-01-01", "1000", "1000"],
      [source, "2025-01-02", "500", "-500"],
      [target, "2025-01-01", "0", "0"],
      [target, "2025-01-02", "0", "0"],
    ]) {
      await tx.execute(
        sql`INSERT INTO portfolio.valuations_daily(user_id,account_id,valuation_date,market_value,cash,total_value,total_value_pln,external_flow,external_flow_pln,as_of,is_complete) VALUES(${owner.userId}::uuid,${account}::uuid,${day}::date,0,${value}::numeric,${value}::numeric,${value}::numeric,${flow}::numeric,${flow}::numeric,${`${day}T20:00:00Z`}::timestamptz,true)`,
      );
    }
  });
  const transferred = await request(
    `performance?accountId=${source}&accountId=${target}&to=2025-01-02`,
  );
  assert.equal(transferred.status, 200, JSON.stringify(await transferred.clone().json()));
  assert.equal((await transferred.json()).total.twr, "-0.5");
  await database.transaction(owner, async (tx) => {
    await tx.execute(sql`DELETE FROM portfolio.valuations_daily WHERE account_id=${source}::uuid`);
  });
  const missing = await request(
    `performance?accountId=${source}&accountId=${target}&to=2025-01-02`,
  );
  assert.equal(
    (await missing.json()).total.twr,
    null,
    "an account with transactions but no valuations is not omitted",
  );
}
