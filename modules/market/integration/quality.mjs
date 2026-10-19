import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { IngestionStore } from "../dist/src/jobs.js";
import { DataQualityHoldError, MarketRepository } from "../dist/src/server/index.js";

// Synthetic instruments and a synthetic calendar in 2031, so other suites' rows never interfere.
const SESSIONS = ["2031-03-03", "2031-03-04", "2031-03-05", "2031-03-06", "2031-03-07"];
const ISINS = ["PLSYNQ000011", "PLSYNQ000029", "PLSYNQ000037"];
export async function testMarketQualityStorage(settings) {
  const db = createAppDatabase({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.passwords.app,
  });
  const repository = new MarketRepository(db, () => new Date("2031-03-07T20:00:00Z"));
  const store = new IngestionStore(repository);
  const context = { userId: null, role: "system" };
  const [gapped, flat, spiky, split] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const bar = (instrumentId, date, close, volume = "1000", extra = {}) => ({
    instrumentId,
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume,
    currency: "PLN",
    noTrades: volume === "0",
    meta: { source: "gpw", asOf: `${date}T16:00:00Z`, delayMinutes: 0, stale: false },
    fetchedAt: "2031-03-07T18:00:00Z",
    ...extra,
  });
  const issues = (id) =>
    db.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT session_date::text AS date,check_code AS code,severity,status,details FROM market.data_quality_issues WHERE instrument_id=${id}::uuid ORDER BY session_date,check_code`,
          )
        ).rows,
    );
  const gpw = (isin, name, date, close, currency = "PLN") => ({
    date,
    name,
    isin,
    currency,
    open: close,
    high: close,
    low: close,
    close,
    volume: "10",
    turnover: "100",
    noTrades: false,
  });
  try {
    await db.transaction(context, async (tx) => {
      for (const [id, ticker] of [
        [gapped, "SYNQGAP"],
        [flat, "SYNQFLAT"],
        [spiky, "SYNQSPIKE"],
        [split, "SYNQSPLIT"],
      ])
        await tx.execute(
          sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency) VALUES(${id}::uuid,'XWAR',${ticker},'Synthetic quality test','stock','PLN')`,
        );
      for (const date of SESSIONS)
        await tx.execute(sql`INSERT INTO market.trading_calendar(mic,session_date,is_open,open_time,close_time,timezone)
          VALUES('XWAR',${date}::date,true,'09:00','17:05','Europe/Warsaw') ON CONFLICT(mic,session_date) DO UPDATE SET is_open=true`);
      await tx.execute(
        sql`INSERT INTO market.corporate_actions(instrument_id,type,ex_date,ratio_from,ratio_to,source) VALUES(${split}::uuid,'split','2031-03-04',1,2,'admin')`,
      );
    });

    // Gap WARN from the calendar; it closes itself when the session's bar arrives.
    await repository.saveBars([
      bar(gapped, "2031-03-03", "10"),
      bar(gapped, "2031-03-04", "10.1"),
      bar(gapped, "2031-03-06", "10.2"),
    ]);
    assert.deepEqual(
      (await issues(gapped)).map(({ date, code, severity, status }) => [
        date,
        code,
        severity,
        status,
      ]),
      [["2031-03-05", "gap", "WARN", "open"]],
    );
    assert.equal(await repository.analysisEligible(context, gapped), true, "WARN never blocks");
    await repository.saveBars([bar(gapped, "2031-03-05", "10.15")]);
    const [closed] = await issues(gapped);
    assert.equal(closed.status, "resolved");
    assert.equal(closed.details.resolution, "bar_received");

    // Six flat zero-volume sessions (history before 2031 has no calendar, so no gaps there).
    const dead = Array.from({ length: 6 }, (_, n) =>
      bar(flat, `2030-12-0${n + 1}`, "5", "0", { noTrades: true }),
    );
    await repository.saveBars([bar(flat, "2030-11-30", "5"), ...dead]);
    assert.deepEqual(
      (await issues(flat)).map(({ date, code, severity }) => [date, code, severity]),
      [["2030-12-06", "dead_candles", "WARN"]],
    );

    // INFO volume spike above 20x the 30-session median, saved in a later batch.
    const quiet = Array.from({ length: 30 }, (_, n) =>
      bar(spiky, `2030-0${1 + Math.floor(n / 28)}-${String((n % 28) + 1).padStart(2, "0")}`, "7"),
    );
    await repository.saveBars(quiet);
    await repository.saveBars([bar(spiky, "2030-02-10", "7", "20000.0001")]);
    const [spike] = await issues(spiky);
    assert.deepEqual([spike.code, spike.severity], ["volume_spike", "INFO"]);
    assert.deepEqual(spike.details, { volume: "20000.0001", median30: "1000" });
    assert.equal(await repository.analysisEligible(context, spiky), true, "INFO never blocks");

    // A 50 % drop on a split day is explained; the jump the next day is a BLOCK with details.
    await repository.saveBars([
      bar(split, "2031-03-03", "100"),
      bar(split, "2031-03-04", "50"),
      bar(split, "2031-03-05", "100"),
    ]);
    const [jump] = (await issues(split)).filter((row) => row.code !== "gap");
    assert.deepEqual(
      [jump.date, jump.code, jump.severity],
      ["2031-03-05", "jump_without_action", "BLOCK"],
    );
    assert.deepEqual(jump.details, { previousClose: "50", close: "100", change: "1.00000000" });
    // Refreshing the same data does not resolve or duplicate the hold (owner decision 2026-10-06).
    await repository.saveBars([bar(split, "2031-03-05", "100")]);
    assert.equal(
      (await issues(split)).filter((row) => row.code === "jump_without_action").length,
      1,
    );
    const holds = await repository.analysisHolds(context, [split, gapped, flat, split]);
    assert.deepEqual(
      holds.map((hold) => [hold.instrumentId, hold.issues.map((issue) => issue.checkCode)]),
      [[split, ["jump_without_action"]]],
    );
    await assert.rejects(
      repository.assertAnalysisEligible(context, [gapped, split]),
      (error) => error instanceof DataQualityHoldError && error.code === "DATA_QUALITY_HOLD",
    );
    await repository.assertAnalysisEligible(context, [gapped, flat, spiky]);
    const quote = (await repository.quotes(context, [split]))[0];
    assert.equal(quote.price, "100.00000000", "A BLOCK keeps prices visible");
    assert.equal(quote.meta.staleReason, "data_quality_hold");

    // GPW archive: a missing session becomes a gap; a new ISIN under a listed short name and a
    // currency drift are BLOCKs on the affected series.
    await store.saveGpw(
      [gpw(ISINS[0], "SYNQOLD", "2031-03-03", "20"), gpw(ISINS[1], "SYNQCUR", "2031-03-03", "30")],
      "2031-03-03T17:00:00Z",
    );
    await store.saveGpw(
      [gpw(ISINS[2], "SYNQOLD", "2031-03-04", "20"), gpw(ISINS[1], "SYNQCUR", "2031-03-04", "30")],
      "2031-03-04T17:00:00Z",
    );
    await store.saveGpw(
      [gpw(ISINS[1], "SYNQCUR", "2031-03-05", "30", "EUR")],
      "2031-03-05T17:00:00Z",
    );
    const byIsin = await db.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT isin,id::text FROM market.instruments WHERE mic='XWAR' AND isin=ANY(${sql.param(ISINS)}::text[])`,
          )
        ).rows,
    );
    const gpwId = (isin) => String(byIsin.find((row) => row.isin === isin)?.id);
    const old = (await issues(gpwId(ISINS[0]))).map((row) => [row.date, row.code, row.severity]);
    assert.deepEqual(old, [
      ["2031-03-04", "gap", "WARN"],
      ["2031-03-04", "isin_change", "BLOCK"],
      ["2031-03-05", "gap", "WARN"],
    ]);
    const renamed = await issues(gpwId(ISINS[2]));
    assert.deepEqual(
      renamed.map((row) => [row.code, row.details]),
      [
        ["isin_change", { isin: ISINS[2], previousIsin: ISINS[0] }],
        ["gap", {}],
      ],
    );
    const currency = (await issues(gpwId(ISINS[1]))).find((row) => row.code === "currency_change");
    assert.deepEqual(
      [currency.date, currency.severity, currency.details],
      ["2031-03-05", "BLOCK", { expected: "PLN", received: "EUR" }],
    );
    assert.equal(await repository.analysisEligible(context, gpwId(ISINS[1])), false);

    // BL-213 counts: archive rows per open XWAR session, newest first; manual rows apart.
    await repository.saveBars([
      bar(flat, "2031-03-07", "5", "1000", {
        meta: { source: "gpw_manual", asOf: "2031-03-07T16:00:00Z", delayMinutes: 0, stale: false },
      }),
    ]);
    assert.deepEqual((await store.gpwSessionCounts("2031-03-07", 20)).slice(0, 5), [
      { date: "2031-03-07", automatic: 0, manual: 1 },
      { date: "2031-03-06", automatic: 1, manual: 0 },
      { date: "2031-03-05", automatic: 2, manual: 0 },
      { date: "2031-03-04", automatic: 4, manual: 0 },
      { date: "2031-03-03", automatic: 4, manual: 0 },
    ]);
    assert.equal((await store.gpwSessionCounts("2031-03-04", 1)).length, 1);
  } finally {
    await db.transaction(context, async (tx) => {
      await tx.execute(
        sql`DELETE FROM market.instruments WHERE id=ANY(${sql.param([gapped, flat, spiky, split])}::uuid[]) OR (mic='XWAR' AND isin=ANY(${sql.param(ISINS)}::text[]))`,
      );
      await tx.execute(
        sql`DELETE FROM market.trading_calendar WHERE mic='XWAR' AND session_date=ANY(${sql.param(SESSIONS)}::date[])`,
      );
    });
    await db.close();
  }
}
