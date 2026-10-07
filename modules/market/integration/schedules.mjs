import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { IngestionStore } from "../dist/src/jobs.js";
import { MarketRepository } from "../dist/src/server/index.js";

export async function testMarketScheduleStorage(settings) {
  const db = createAppDatabase({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.passwords.app,
  });
  const store = new IngestionStore(new MarketRepository(db));
  const us = randomUUID(),
    pl = randomUUID();
  const context = { userId: null, role: "system" };
  try {
    await db.transaction(context, async (tx) => {
      for (const [id, mic, currency] of [
        [us, "XNAS", "USD"],
        [pl, "XWAR", "PLN"],
      ])
        await tx.execute(
          sql`INSERT INTO market.instruments(id,mic,name,type,currency) VALUES(${id}::uuid,${mic},'Synthetic session test','stock',${currency})`,
        );
      for (const [mic, zone, open, close] of [
        ["XNAS", "America/New_York", "09:30", "16:00"],
        ["XWAR", "Europe/Warsaw", "09:00", "17:05"],
      ])
        for (const [date, isOpen] of [
          ["2026-03-06", true],
          ["2026-03-16", true],
          ["2026-03-17", false],
        ])
          await tx.execute(
            sql`INSERT INTO market.trading_calendar(mic,session_date,is_open,open_time,close_time,timezone) VALUES(${mic},${date}::date,${isOpen},${open}::time,${close}::time,${zone}) ON CONFLICT(mic,session_date) DO UPDATE SET is_open=EXCLUDED.is_open,open_time=EXCLUDED.open_time,close_time=EXCLUDED.close_time,timezone=EXCLUDED.timezone`,
          );
    });
    assert.deepEqual(await store.activeIds([us], "2026-03-06T14:00:00Z"), []);
    assert.deepEqual(await store.activeIds([us], "2026-03-16T14:00:00Z"), [us]);
    assert.deepEqual(await store.activeIds([pl], "2026-03-16T07:59:59Z"), []);
    assert.deepEqual(await store.activeIds([pl], "2026-03-16T08:00:00Z"), [pl]);
    assert.deepEqual(await store.activeIds([pl], "2026-03-16T16:05:01Z"), []);
    assert.deepEqual(await store.activeIds([us, pl], "2026-03-17T14:00:00Z"), []);
    assert.deepEqual(await store.activeIds([], "2026-03-16T14:00:00Z"), []);
    assert.deepEqual(await store.activeIds([us], "2026-03-18T14:00:00Z"), []);
  } finally {
    await db.transaction(context, (tx) =>
      tx.execute(sql`DELETE FROM market.instruments WHERE id=ANY(${sql.param([us, pl])}::uuid[])`),
    );
    await db.close();
  }
}
