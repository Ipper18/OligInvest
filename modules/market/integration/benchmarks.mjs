import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { BENCHMARKS } from "../dist/src/benchmarks.js";
import { IngestionStore } from "../dist/src/jobs.js";
import { MarketRepository } from "../dist/src/server/index.js";

export async function testMarketBenchmarkStorage(settings) {
  const db = createAppDatabase({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.passwords.app,
  });
  const repository = new MarketRepository(db);
  const store = new IngestionStore(repository);
  const context = { userId: null, role: "system" };
  const existing = randomUUID();
  const symbols = BENCHMARKS.map((item) => item.yahoo);
  try {
    // A symbol mapped earlier (e.g. by search) keeps its instrument; no duplicate is created.
    await db.transaction(context, async (tx) => {
      await tx.execute(
        sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${existing}::uuid,'ARCX','SYNSPY','Synthetic mapped ETF','etf','USD')`,
      );
      await tx.execute(
        sql`INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id) VALUES('yahoo','SPY',${existing}::uuid)`,
      );
    });
    const first = await store.ensureBenchmarks(BENCHMARKS, "2026-10-19");
    const second = await store.ensureBenchmarks(BENCHMARKS, "2026-10-20");
    assert.deepEqual(
      second.map((item) => item.id),
      first.map((item) => item.id),
      "Idempotent catalog",
    );
    const spy = first.find((item) => item.definition.code === "SPY");
    assert.equal(spy.id, existing);
    const members = await db.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT count(*)::int AS n FROM market.universe_members m JOIN market.universes u ON u.id=m.universe_id WHERE u.code='benchmarks' AND m.valid_to IS NULL`,
          )
        ).rows[0].n,
    );
    assert.equal(members, BENCHMARKS.length, "One open membership per benchmark");
    const wig20 = first.find((item) => item.definition.code === "WIG20");
    const level = (date, close) => ({
      instrumentId: wig20.id,
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: "0",
      currency: "PLN",
      noTrades: false,
      meta: { source: "yahoo", asOf: `${date}T15:00:00Z`, delayMinutes: 0, stale: false },
      fetchedAt: "2026-10-19T21:45:00Z",
    });
    await repository.saveBars([level("2021-10-15", "2300.12"), level("2026-10-16", "2500.5")]);
    const listed = await repository.benchmarks({ userId: randomUUID(), role: "user" });
    assert.deepEqual(
      listed.map((item) => item.code),
      BENCHMARKS.map((item) => item.code),
    );
    const index = listed.find((item) => item.code === "WIG20");
    assert.deepEqual(index, {
      code: "WIG20",
      name: "WIG20",
      kind: "index",
      instrumentId: wig20.id,
      currency: "PLN",
      dataAvailableFrom: "2021-10-15",
    });
    const proxy = listed.find((item) => item.code === "QQQ");
    assert.equal(proxy.kind, "etf_proxy");
    assert.equal(proxy.proxyFor, "NDX");
    assert.equal(proxy.dataAvailableFrom, undefined);
    // Index levels with zero volume are neither dead candles nor no-trade rows; only calendar
    // gaps (other suites' open XWAR sessions inside the five years) may be reported.
    const issues = await db.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT count(*)::int AS n FROM market.data_quality_issues WHERE instrument_id=${wig20.id}::uuid AND check_code<>'gap'`,
          )
        ).rows[0].n,
    );
    assert.equal(issues, 0);
  } finally {
    await db.transaction(context, async (tx) => {
      await tx.execute(
        sql`DELETE FROM market.instruments WHERE id=${existing}::uuid OR id IN (SELECT instrument_id FROM market.instrument_provider_symbols WHERE provider='yahoo' AND symbol=ANY(${sql.param(symbols)}::text[]))`,
      );
      await tx.execute(sql`DELETE FROM market.universes WHERE code='benchmarks'`);
    });
    await db.close();
  }
}
