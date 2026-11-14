import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

/** BL-307 on real PostgreSQL: RLS, stored NBP rates with table numbers, gaps without zeros. */
export async function testDividends({ request, database, owner }) {
  const post = async (path, body) => {
    const response = await request(path, "POST", body, { "Idempotency-Key": randomUUID() });
    assert.equal(response.status, 201, `${path}: ${JSON.stringify(await response.clone().json())}`);
    return response.json();
  };
  const instrumentId = randomUUID();
  await database.transaction(owner, async (tx) => {
    await tx.execute(
      sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${instrumentId}::uuid,'XNYS',${`D${instrumentId.slice(0, 8)}`},'Synthetic dividend payer','stock','USD')`,
    );
  });
  await database.transaction({ userId: null, role: "system" }, async (tx) => {
    // Synthetic rates and table numbers (test data only). The 2024-04-15 rate would be used if
    // the payment date were shifted by a trade settlement cycle (§ 4.3: it is not).
    for (const [date, rate, table] of [
      ["2024-04-10", "3.9", "070/A/NBP/2024"],
      ["2024-04-11", "3.95", "071/A/NBP/2024"],
      ["2024-04-15", "4.1", "073/A/NBP/2024"],
    ])
      await tx.execute(
        sql`INSERT INTO market.fx_rates(base,quote,rate_date,rate,source,table_no) VALUES('USD','PLN',${date}::date,${rate}::numeric,'nbp',${table}) ON CONFLICT(base,quote,rate_date,source) DO UPDATE SET rate=excluded.rate,table_no=excluded.table_no`,
      );
  });
  const account = await post("accounts", {
    name: "Synthetic dividends",
    accountType: "regular",
    broker: "other",
    currency: "PLN",
  });
  await post("transactions", {
    accountId: account.id,
    type: "DEPOSIT",
    tradeDate: "2024-02-01",
    amount: { amount: "5000", currency: "PLN" },
  });
  await post("transactions", {
    accountId: account.id,
    type: "BUY",
    tradeDate: "2024-02-05",
    settleDate: "2024-02-06",
    instrumentId,
    quantity: "10",
    price: "100",
    priceCurrency: "USD",
    fxRate: "4",
  });
  const dividend = (tradeDate, extra = {}) =>
    post("transactions", {
      accountId: account.id,
      type: "DIVIDEND",
      tradeDate,
      instrumentId,
      quantity: "10",
      price: "0.5",
      priceCurrency: "USD",
      amount: { amount: "16.79", currency: "PLN" },
      ...extra,
    });
  // 10 × 0.5 USD gross with 15 % withholding; before the first stored rate; without withholding.
  const paid = await dividend("2024-04-12", { tax: { amount: "0.75", currency: "USD" } });
  const early = await dividend("2024-03-04", { tax: { amount: "0.75", currency: "USD" } });
  const unrecorded = await dividend("2024-05-10");
  const get = async (query) => {
    const response = await request(`dividends?accountId=${account.id}&${query}`);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const result = await get("to=2024-06-28");
  assert.equal(result.status, "incomplete");
  const byId = new Map(result.rows.map((r) => [r.transactionId, r]));
  const row = byId.get(paid.id);
  assert.equal(row.payDate, "2024-04-12", "income day is the payment date, no settlement cycle");
  assert.deepEqual(row.fxRate, {
    rate: "3.95",
    rateDate: "2024-04-11",
    source: "nbp",
    tableNo: "071/A/NBP/2024",
  });
  // 5 · 3.95 = 19.75; 19 % = 3.7525; credit 0.75 · 3.95 = 2.9625; top-up 0.79.
  assert.equal(row.grossPln.amount, "19.75000000");
  assert.equal(row.withholdingTaxPln.amount, "2.96250000");
  assert.equal(row.netPln.amount, "16.78750000");
  assert.equal(row.tax.status, "computed");
  assert.equal(row.tax.estimatedTopUpPln.amount, "0.79000000");
  assert.deepEqual(row.credited, { amount: "16.79000000", currency: "PLN" });
  // Missing rate: null with a reason, never 0.
  const gap = byId.get(early.id);
  assert.deepEqual(gap.gaps, ["missing_fx"]);
  assert.equal(gap.grossPln, null);
  assert.equal(gap.fxRate, null);
  assert.equal(gap.tax.estimatedTopUpPln, null);
  assert.equal(gap.net.amount, "4.25000000");
  // Withholding not recorded: withholding, net and top-up are null.
  const missing = byId.get(unrecorded.id);
  assert.deepEqual(missing.gaps, ["missing_withholding"]);
  assert.equal(missing.withholdingTax, null);
  assert.equal(missing.netPln, null);
  assert.equal(missing.tax.status, "missing_withholding");
  // Last business-day rate before 2024-05-10 stored here: 2024-04-15 (4.1).
  assert.equal(missing.grossPln.amount, "20.50000000");
  assert.equal(result.totals.grossPln, null);
  assert.equal(result.totals.estimatedTopUpPln, null);
  assert.deepEqual(result.gaps, [
    { reason: "missing_fx", payments: 1 },
    { reason: "missing_withholding", payments: 1 },
  ]);
  // Yield on cost: 12-month gross in PLN is unknown because of the March gap.
  const [position] = result.byInstrument;
  assert.equal(position.yieldOnCost.reason, "missing_fx");
  assert.equal(position.yieldOnCost.ratio, null);
  assert.equal(position.yieldOnCost.costPln.amount, "4000.00000000");
  // Only the complete payment: totals and the 12-month yield are known.
  const april = await get("from=2024-04-01&to=2024-04-30");
  assert.equal(april.status, "ok");
  assert.equal(april.rows.length, 1);
  assert.equal(april.totals.estimatedTopUpPln.amount, "0.79000000");
  assert.equal(april.meta.attribution, "Kursy: NBP");
  const years = await get("from=2024-04-01&to=2025-03-31");
  assert.equal(years.byYear[0].year, 2024);
  // 12 months to 2025-03-31 hold the April and May payments: (19.75 + 20.5) / 4000.
  assert.equal(years.byInstrument[0].yieldOnCost.reason, null);
  assert.equal(years.byInstrument[0].yieldOnCost.ratio, "0.0100625");
  const later = await get("to=2025-04-30");
  // 12 months to 2025-04-30 start after 2024-04-30: only the May payment.
  assert.equal(later.byInstrument[0].yieldOnCost.trailingGrossPln.amount, "20.50000000");
  assert.equal(later.byInstrument[0].yieldOnCost.ratio, "0.005125");
  const foreign = await request(`dividends?accountId=${account.id}`, "GET", undefined, {
    "x-owner": "b",
  });
  assert.equal(foreign.status, 404, "PostgreSQL RLS hides a foreign account even from admin");
  assert.equal((await foreign.json()).code, "NOT_FOUND");
  const other = await request("dividends", "GET", undefined, { "x-owner": "b" });
  assert.equal(other.status, 200);
  const otherBody = JSON.stringify(await other.json());
  assert(!otherBody.includes(account.id) && !otherBody.includes(instrumentId));
  assert.equal((await request("dividends", "GET", undefined, { "x-owner": "" })).status, 401);
  for (const query of [
    "to=2099-01-01",
    "unknown=1",
    "from=2024-05-02&to=2024-05-01",
    "to=2024-03-01&to=2024-03-02",
  ])
    assert.equal((await request(`dividends?${query}`)).status, 422, query);
}
