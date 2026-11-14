import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

/** BL-306 on real PostgreSQL: RLS, stored EOD bars and NBP rates with a table number. */
export async function testCurrencyExposure({ request, database, owner }) {
  const post = async (path, body) => {
    const response = await request(path, "POST", body, { "Idempotency-Key": randomUUID() });
    assert.equal(response.status, 201, `${path}: ${JSON.stringify(await response.clone().json())}`);
    return response.json();
  };
  const instrumentId = randomUUID();
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${instrumentId}::uuid,'XNAS',${`X${instrumentId.slice(0, 8)}`},'Synthetic FX exposure','stock','USD')`,
    );
    for (const [date, close] of [
      ["2024-03-05", "105"],
      ["2024-03-07", "110"],
    ])
      await tx.execute(
        sql`INSERT INTO market.bars_daily(instrument_id,session_date,close,source) VALUES(${instrumentId}::uuid,${date}::date,${close}::numeric,'yahoo')`,
      );
  });
  await database.transaction({ userId: null, role: "system" }, async (tx) => {
    // Synthetic rate and table number (test data only).
    await tx.execute(
      sql`INSERT INTO market.fx_rates(base,quote,rate_date,rate,source,table_no) VALUES('USD','PLN','2024-03-07',4,'nbp','047/A/NBP/2024') ON CONFLICT(base,quote,rate_date,source) DO UPDATE SET rate=excluded.rate,table_no=excluded.table_no`,
    );
  });
  const account = await post("accounts", {
    name: "Synthetic FX exposure",
    accountType: "regular",
    broker: "other",
    currency: "PLN",
  });
  await post("transactions", {
    accountId: account.id,
    type: "DEPOSIT",
    tradeDate: "2024-03-01",
    amount: { amount: "1000", currency: "PLN" },
  });
  await post("transactions", {
    accountId: account.id,
    type: "BUY",
    tradeDate: "2024-03-04",
    settleDate: "2024-03-05",
    instrumentId,
    quantity: "2",
    price: "100",
    priceCurrency: "USD",
    fxRate: "3.8",
  });
  const get = async (query) => {
    const response = await request(`currency-exposure?accountId=${account.id}&${query}`);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const result = await get("asOf=2024-03-08");
  assert.equal(result.status, "ok");
  const [pln, usd] = result.slices;
  assert.equal(pln.currency, "PLN");
  assert.equal(pln.value.amount, "240.00000000");
  assert.deepEqual(usd.valueInCurrency, { amount: "220.00000000", currency: "USD" });
  assert.equal(usd.value.amount, "880.00000000");
  assert.deepEqual(usd.fxRate, {
    rate: "4",
    rateDate: "2024-03-07",
    source: "nbp",
    tableNo: "047/A/NBP/2024",
  });
  assert.equal(result.total.amount, "1120.00000000");
  assert.equal(typeof usd.weight, "string");
  const [row] = result.decomposition.rows;
  // r0 = 760 / 200 = 3.8; price effect (220 − 200) · 3.8 = 76; FX effect = 120 − 76.
  assert.equal(row.unrealizedPl.amount, "120.00000000");
  assert.equal(row.priceEffect.amount, "76.00000000");
  assert.equal(row.fxEffect.amount, "44.00000000");
  assert.equal(result.meta.attribution, "Dane: Yahoo Finance · Kursy: NBP");
  // Before the first NBP table the USD slice is known only in USD: null with a reason.
  const gap = await get("asOf=2024-03-06");
  assert.equal(gap.status, "incomplete");
  assert.equal(gap.total, null);
  assert.equal(gap.slices[1].status, "missing_fx");
  assert.equal(gap.slices[1].value, null);
  assert.equal(gap.slices[1].valueInCurrency.amount, "210.00000000");
  assert.equal(gap.decomposition.exclusions[0].reason, "missing_fx");
  assert.equal(gap.decomposition.rows[0].fxEffect, null);
  const before = await get("asOf=2024-03-02");
  assert.equal(before.slices.length, 1, "only the deposit exists before the purchase");
  const foreign = await request(`currency-exposure?accountId=${account.id}`, "GET", undefined, {
    "x-owner": "b",
  });
  assert.equal(foreign.status, 404, "PostgreSQL RLS hides a foreign account even from admin");
  assert.equal((await foreign.json()).code, "NOT_FOUND");
  const other = await request("currency-exposure", "GET", undefined, { "x-owner": "b" });
  assert.equal(other.status, 200);
  const otherBody = JSON.stringify(await other.json());
  assert(!otherBody.includes(account.id) && !otherBody.includes(instrumentId));
  assert.equal(
    (await request("currency-exposure", "GET", undefined, { "x-owner": "" })).status,
    401,
  );
  for (const query of ["asOf=2099-01-01", "unknown=1", "asOf=2024-03-01&asOf=2024-03-02"])
    assert.equal((await request(`currency-exposure?${query}`)).status, 422, query);
}
