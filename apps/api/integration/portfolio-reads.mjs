import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

export async function testPortfolioReads({ request, database, owner, instrumentId }) {
  const post = async (path, body) => {
    const response = await request(path, "POST", body, { "Idempotency-Key": randomUUID() });
    assert.equal(response.status, 201, `${path}: ${JSON.stringify(await response.clone().json())}`);
    return response.json();
  };
  const get = async (path) => {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const accounts = [];
  for (const accountType of ["regular", "regular", "ike", "ikze"])
    accounts.push(
      await post("accounts", {
        name: `Read ${accounts.length}`,
        accountType,
        broker: "xtb",
        currency: "PLN",
      }),
    );
  const transfer = (accountId, known) =>
    post("transactions", {
      accountId,
      type: "SECURITY_TRANSFER_IN",
      instrumentId,
      tradeDate: "2026-10-12",
      quantity: "2",
      ...(known
        ? { acquisitionCost: { amount: "10", currency: "PLN" }, acquiredOn: "2026-10-09" }
        : {}),
    });
  await transfer(accounts[0].id, true);
  await transfer(accounts[1].id, false);
  const selection = accounts
    .slice(0, 2)
    .map((a) => `accountId=${a.id}`)
    .join("&");
  const unpriced = await get(`positions?${selection}&groupBy=instrument`);
  assert.equal(unpriced.data.length, 1);
  assert.equal(unpriced.data[0].quantity, "4");
  for (const field of ["marketValue", "marketValueBase", "weight", "costBasis", "unrealizedPl"])
    assert.equal(unpriced.data[0][field], null, field);
  assert.equal(Object.hasOwn(unpriced.data[0], "accountId"), false);
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO market.quotes_latest(instrument_id,price,as_of,fetched_at,source,delay_minutes) VALUES(${instrumentId}::uuid,8,'2026-10-13T11:45:00Z','2026-10-13T11:55:00Z','yahoo',15)`,
    );
  });
  const priced = await get(`positions?${selection}&groupBy=instrument`);
  assert.equal(priced.isComplete, true);
  assert.equal(priced.data[0].quantity, "4");
  assert.equal(priced.data[0].marketValueBase.amount, "32.00000000");
  assert.equal(priced.data[0].costBasis, null);
  assert.equal(priced.data[0].unrealizedPl, null);
  assert.equal(
    priced.data[0].meta.stale,
    false,
    "five-minute quote is within the seven-minute cadence",
  );
  assert.equal(priced.totals.exclusions.count, 1);
  assert.equal(priced.totals.unrealizedPl.amount, "6.00000000");
  const day = await get(`day-change?${selection}`);
  assert.equal(day.currentValue.amount, "32.00000000");
  assert.equal(day.previousValue, null);
  assert.equal(day.change, null);
  assert.equal(day.changeRatio, null);
  const summary = await get(`summary?${selection}`);
  assert.equal(summary.dayChange, null);
  assert.equal(summary.isComplete, true);
  assert.equal(day.residualChange, null);
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO market.bars_daily(instrument_id,session_date,close,source) VALUES(${instrumentId}::uuid,'2026-10-12',7,'gpw')`,
    );
  });
  const pricedDay = await get(`day-change?${selection}`);
  assert.equal(pricedDay.change.amount, "4.00000000");
  assert.equal(pricedDay.positions[0].change.amount, "4.00000000");
  assert.equal(pricedDay.residualChange.amount, "0.00000000");
  const sell = (accountId) =>
    post("transactions", {
      accountId,
      type: "SELL",
      instrumentId,
      tradeDate: "2026-10-13",
      settleDate: "2026-10-15",
      quantity: "1",
      price: "8",
      priceCurrency: "PLN",
    });
  await sell(accounts[0].id);
  const unknown = await sell(accounts[1].id);
  const realized = await get(`realized?${selection}&groupBy=instrument`);
  assert.equal(realized.isComplete, false);
  assert.equal(realized.rows[0].status, "missing_cost");
  for (const field of ["cost", "proceeds", "realizedPl"])
    assert.equal(realized.rows[0][field], null);
  assert.equal(realized.exclusions[0].transactionId, unknown.id);
  assert.equal(realized.totals.proceeds.amount, "8.00000000");
  assert.equal(realized.totals.cost.amount, "5.00000000");
  const soldDay = await get(`day-change?${selection}`);
  assert.equal(
    soldDay.positions[0].change.amount,
    "4.00000000",
    "sale proceeds do not inflate day contribution",
  );
  assert.equal(soldDay.residualChange.amount, "0.00000000");
  assert.equal(realized.totals.realizedPl.amount, "3.00000000");
  for (const account of accounts.slice(2)) {
    await transfer(account.id, true);
    await sell(account.id);
    const tax = await get(`realized?accountId=${account.id}&view=tax`);
    assert.equal(tax.isComplete, false);
    assert.equal(tax.rows[0].status, "not_applicable");
    assert.equal(tax.rows[0].realizedPl, null);
    assert.equal(tax.exclusions[0].reason, "not_applicable");
  }
  // Quotes in instrument currency remain known when conversion into PLN is unavailable.
  const foreign = randomUUID();
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${foreign}::uuid,'XNAS',${`F${foreign.slice(0, 8)}`},'Synthetic FX gap','stock','USD')`,
    );
    await tx.execute(
      sql`INSERT INTO market.quotes_latest(instrument_id,price,as_of,fetched_at,source,delay_minutes) VALUES(${foreign}::uuid,8,'2026-10-13T11:45:00Z','2026-10-13T11:55:00Z','yahoo',15)`,
    );
  });
  await post("transactions", {
    accountId: accounts[0].id,
    type: "SECURITY_TRANSFER_IN",
    instrumentId: foreign,
    tradeDate: "2026-10-12",
    quantity: "3",
  });
  const missingFx = await get(`positions?accountId=${accounts[0].id}`);
  const position = missingFx.data.find((p) => p.instrument.id === foreign);
  assert.equal(missingFx.isComplete, false);
  assert.equal(position.quantity, "3");
  assert.equal(position.marketValue.amount, "24.00000000");
  assert.equal(position.marketValueBase, null);
  assert.equal(position.costBasis, null);
  assert.equal(position.weight, null);
  for (const path of ["summary", "day-change", "positions", "cash", "lots", "realized"]) {
    const other = await (
      await request(`${path}?${selection}`, "GET", undefined, { "x-owner": "b" })
    ).json();
    assert(!JSON.stringify(other).includes(accounts[0].id));
    assert(!JSON.stringify(other).includes(instrumentId));
  }
}
