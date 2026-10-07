import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";
import { MarketRepository } from "../dist/modules.js";

export async function testMarketStorage(settings) {
  const database = createAppDatabase({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.passwords.app,
  });
  const context = { userId: null, role: "system" };
  const now = () => new Date("2026-10-06T12:00:00Z");
  const repository = new MarketRepository(database, now);
  const id = randomUUID();
  const other = randomUUID();
  const logger = { info() {}, warn() {}, error() {} };
  let searches = 0;
  const app = createApp({
    checks: {},
    logger,
    publicBaseUrl: "https://example.test",
    market: {
      repository: () => repository,
      authorize: async (request) => {
        if (request.headers.get("x-test-auth") !== "yes") throw new ProblemError("UNAUTHENTICATED");
        return context;
      },
      searchInBackground: async () => {
        searches++;
      },
    },
  });
  const get = (path, headers = {}) =>
    app.request(`/api/v1/market/${path}`, { headers: { "x-test-auth": "yes", ...headers } });
  const bar = (date, close) => ({
    instrumentId: id,
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: "0.1",
    currency: "PLN",
    noTrades: false,
    meta: { source: "gpw", asOf: `${date}T18:00:00Z`, delayMinutes: 0, stale: false },
    fetchedAt: now().toISOString(),
  });
  try {
    await database.transaction(context, async (tx) => {
      for (const [key, ticker] of [
        [id, "SYNMARKET"],
        [other, "SYNMARKET2"],
      ])
        await tx.execute(
          sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${key}::uuid,'XWAR',${ticker},'Synthetic market test','stock','PLN')`,
        );
    });
    await repository.saveBars([bar("2026-10-05", "100"), bar("2026-10-06", "125.00000001")]);
    assert.equal(await repository.analysisEligible(context, id), false);
    assert.equal((await repository.quotes(context, [id]))[0].meta.staleReason, "data_quality_hold");
    const response = await get(`instruments/${id}/chart?maxPoints=50`);
    assert.equal(response.status, 200, await response.clone().text());
    const chart = await response.json();
    assert.equal(chart.meta.staleReason, "data_quality_hold");
    assert.equal(chart.c.at(-1), "125.00000001");
    assert.ok(chart.c.every((value) => typeof value === "string"));
    const etag = response.headers.get("etag");
    assert.ok(etag);
    assert.equal(
      (await get(`instruments/${id}/chart?maxPoints=50`, { "if-none-match": etag })).status,
      304,
    );
    assert.equal(
      (
        await app.request(`/api/v1/market/instruments/${id}/chart`, {
          headers: { "if-none-match": etag },
        })
      ).status,
      401,
    );
    assert.equal((await get(`instruments/${id}`)).status, 200);
    assert.equal((await get(`instruments/${id}/chart?maxPoints=3001`)).status, 422);
    assert.equal((await get(`instruments/${randomUUID()}`)).status, 404);
    const first = await (await get("instruments?q=SYNMARKET&limit=1")).json();
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = await (
      await get(`instruments?q=SYNMARKET&limit=1&cursor=${first.nextCursor}`)
    ).json();
    assert.equal(second.items.length, 1);
    assert.notEqual(first.items[0].id, second.items[0].id);
    assert.equal((await get(`instruments?q=changed&cursor=${first.nextCursor}`)).status, 422);
    assert.ok(searches >= 2);
    await repository.saveBars([
      bar("2026-10-06", "125.00000001"),
      bar("2026-10-06", "125.00000001"),
    ]);
    const issues = await database.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT check_code FROM market.data_quality_issues WHERE instrument_id=${id}::uuid ORDER BY check_code`,
          )
        ).rows,
    );
    assert.deepEqual(
      issues.map((x) => x.check_code),
      ["duplicate", "jump_without_action"],
    );
    const durations = [];
    for (let n = 0; n < 50; n++) {
      const start = performance.now();
      await get("instruments?q=SYNMARKET");
      durations.push(performance.now() - start);
    }
    assert.ok(durations.sort((a, b) => a - b)[47] < 300, "Local catalog p95 < 300 ms");
  } finally {
    await database.transaction(context, (tx) =>
      tx.execute(
        sql`DELETE FROM market.instruments WHERE id=ANY(${sql.param([id, other])}::uuid[])`,
      ),
    );
    await database.close();
  }
}
