import assert from "node:assert/strict";
import { evaluateAlerts } from "@oliginvest/mod-alerts/jobs";
import { readAlertObservation } from "@oliginvest/mod-portfolio/jobs";
import { sql } from "drizzle-orm";

export async function testValuationAlerts({
  appDatabase,
  alerts,
  context,
  other,
  accountId,
  instrumentId,
  secondInstrumentId,
  targetRequest,
  origin,
  today,
}) {
  // Keep snapshots separate from today's quick-action fixtures. The account already has a deposit.
  const start = new Date(today + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() + 1);
  const day = start.toISOString().slice(0, 10);
  const rules = [];
  for (const weight of [{ assetClass: "equity" }, { instrumentId }]) {
    const response = await targetRequest("", "POST", {
      name: weight.assetClass ?? instrumentId,
      accountId,
      targets: [{ ...weight, weight: "1" }],
    });
    assert.equal(response.status, 201);
    const { id: targetId } = await response.json();
    const rule = await alerts.create(context, {
      type: "allocation_drift",
      params: { targetId, threshold: "0.1" },
      cooldownMinutes: 5,
    });
    rules.push(rule.data.id);
  }

  async function snapshot(minute, first, second, complete) {
    const instant = new Date(start.getTime() + minute * 60000).toISOString();
    await appDatabase.transaction(context, async (tx) => {
      await tx.execute(sql`INSERT INTO portfolio.valuations_daily
        (user_id,account_id,valuation_date,market_value,cash,total_value,total_value_pln,fx_rate_to_pln,as_of,is_complete)
        VALUES (${context.userId},${accountId},${day},${first + second},${100 - first - second},100,100,1,${instant},${complete})
        ON CONFLICT (account_id,valuation_date) DO UPDATE SET market_value=excluded.market_value,cash=excluded.cash,as_of=excluded.as_of,is_complete=excluded.is_complete`);
      for (const [id, amount] of [
        [instrumentId, first],
        [secondInstrumentId, second],
      ]) {
        await tx.execute(sql`INSERT INTO portfolio.positions_daily
          (user_id,account_id,instrument_id,valuation_date,quantity,market_value_pln)
          VALUES (${context.userId},${accountId},${id},${day},1,${amount})
          ON CONFLICT (account_id,instrument_id,valuation_date) DO UPDATE SET market_value_pln=excluded.market_value_pln`);
      }
    });
    return new Date(instant);
  }
  const run = (owner, now) =>
    evaluateAlerts(
      appDatabase,
      { v: 1, mode: "valuation", userId: owner.userId },
      origin,
      now,
      readAlertObservation,
    );
  async function values(owner) {
    return Promise.all(
      rules.map(async (ruleId) =>
        (await alerts.events(owner, { ruleId, limit: 20 })).data.map((event) =>
          Number(event.value),
        ),
      ),
    );
  }

  await run(context, await snapshot(0, 20, 30, false));
  assert.deepEqual(await values(context), [[], []]);
  const complete = await snapshot(1, 20, 30, true);
  await run(other, complete);
  assert.deepEqual(await values(context), [[], []]);
  await run(context, complete);
  // The class aggregates both positions (50/100), the instrument only its own (20/100).
  assert.deepEqual(await values(context), [[0.5], [0.8]]);
  assert.deepEqual(await values(other), [[], []]);
  await run(context, await snapshot(2, 100, 0, true)); // Re-arm below threshold.
  await run(context, await snapshot(3, 20, 30, true));
  assert.deepEqual(await values(context), [[0.5], [0.8]]);
  await run(context, await snapshot(6, 20, 30, true)); // Cooldown expires.
  assert.deepEqual(await values(context), [
    [0.5, 0.5],
    [0.8, 0.8],
  ]);
}
