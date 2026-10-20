import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { createAnalyticsResults } from "@oliginvest/mod-analytics/jobs";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";
import { analyticsModule } from "../dist/modules.js";

const series = (n, start) => Array.from({ length: n }, (_, i) => start + i);
/** Synthetic distribution with the shape of the worker result (values are not meaningful). */
function workerResult(runId) {
  const months = series(13, 0);
  const fan = (k) => ({
    p5: months.map((m) => 100 + m * k),
    p25: months.map((m) => 101 + m * k),
    p50: months.map((m) => 102 + m * k),
    p75: months.map((m) => 103 + m * k),
    p95: months.map((m) => 104 + m * k),
  });
  return {
    v: 1,
    runId,
    status: "done",
    finishedAt: "2026-10-20T12:00:05.000Z",
    durationMs: 4000,
    result: {
      kind: "monte_carlo",
      currency: "PLN",
      months,
      nominal: fan(2),
      real: fan(1),
      goalProbability: null,
      maxDrawdownPercentiles: { p5: -0.4, p50: -0.2, p95: -0.05 },
      sensitivity: [
        { scenario: "mean_minus_2pp", endValueP5: 90, endValueP50: 110, goalProbability: null },
        { scenario: "mean_plus_2pp", endValueP5: 95, endValueP50: 130, goalProbability: null },
      ],
    },
    assumptions: { model: "stationary_bootstrap", historyMonths: 240 },
    warnings: [{ code: "SHORT_HISTORY", severity: "warning", message: "Synthetic." }],
    reproducibility: {
      seed: 7,
      algorithmVersion: "mc-1.0.0",
      dataVersion: { WIG: "2006-01..2026-09" },
      libraries: { numpy: "2.5.0" },
    },
  };
}

export async function testAnalyticsStorage(settings) {
  const options = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAppDatabase({ ...options, password: settings.passwords.app });
  const auth = createAuthDatabase({ ...options, password: settings.passwords.auth });
  const users = { pro: randomUUID(), other: randomUUID(), basic: randomUUID() };
  const roles = { pro: "pro", other: "pro", basic: "user" };
  const queued = [];
  const removable = new Set();
  const cancels = [];
  const queue = {
    enqueue: async (job) => {
      queued.push(job);
      removable.add(job.runId);
    },
    remove: async (runId) => removable.delete(runId),
    requestCancel: async (runId) => {
      cancels.push(runId);
    },
  };
  const repository = new analyticsModule.AnalyticsRepository(
    database,
    () => queue,
    () => new Date("2026-10-20T10:00:00Z"),
  );
  const app = createApp({
    checks: {},
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: "https://example.test",
    auth: {
      service: async () => ({
        requireData: async (request) => {
          const who = request.headers.get("x-owner");
          if (!who) throw new ProblemError("UNAUTHENTICATED");
          return { user_id: users[who], role: roles[who] };
        },
        features: { enabled: async () => true },
        renewSession: async () => null,
      }),
      clientIp: () => "192.0.2.1",
    },
    analytics: {
      repository: () => repository,
      authorize: async (request) => {
        const who = request.headers.get("x-owner");
        if (!who) throw new ProblemError("UNAUTHENTICATED");
        return { userId: users[who], role: roles[who] };
      },
      assertOrigin: (request) => {
        if (request.method !== "GET" && request.headers.get("origin") !== "https://example.test")
          throw new ProblemError("FORBIDDEN");
      },
    },
  });
  const request = (path, method = "GET", body, headers = {}) =>
    app.request(`/api/v1/analytics/${path}`, {
      method,
      headers: {
        "x-owner": "pro",
        origin: "https://example.test",
        "content-type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = (body, key = randomUUID(), who = "pro") =>
    request("runs", "POST", body, { "Idempotency-Key": key, "x-owner": who });
  const monteCarlo = {
    type: "monte_carlo",
    params: {
      horizonYears: 2,
      paths: 1000,
      contributions: [{ amount: { amount: "500", currency: "PLN" }, frequency: "monthly" }],
      goal: { amount: "50000", currency: "PLN" },
    },
  };
  const published = [];
  const results = createAnalyticsResults({
    database,
    publish: async (userId, event) => {
      published.push({ userId, ...event });
    },
  });
  try {
    await auth.transaction(async (tx) => {
      for (const id of Object.values(users))
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email)VALUES(${id}::uuid,'Synthetic analytics test',${`${id}@example.invalid`})`,
        );
    });
    const stock = randomUUID(),
      us = randomUUID();
    const proxies = await database.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency)VALUES(${stock}::uuid,'XWAR',${`A${stock.slice(0, 8)}`},'Synthetic GPW','stock','PLN'),(${us}::uuid,'XNAS',${`U${us.slice(0, 8)}`},'Synthetic US','stock','USD')`,
      );
      await tx.execute(
        sql`INSERT INTO market.instruments(mic,ticker,name,type,currency,country)VALUES('XWAR','WIG','WIG','index','PLN','PL'),('XNYS','^GSPC','S&P 500','index','USD','US') ON CONFLICT(mic,ticker) WHERE ticker IS NOT NULL DO NOTHING`,
      );
      return Object.fromEntries(
        (
          await tx.execute(
            sql`SELECT ticker,id::text FROM market.instruments WHERE (mic,ticker) IN (('XWAR','WIG'),('XNYS','^GSPC'))`,
          )
        ).rows.map((r) => [r.ticker, r.id]),
      );
    });
    const owner = { userId: users.pro, role: "pro" };
    const account = randomUUID();
    await database.transaction(owner, async (tx) => {
      await tx.execute(
        sql`INSERT INTO portfolio.accounts(id,user_id,name,broker,currency)VALUES(${account}::uuid,${users.pro}::uuid,'MC','xtb','PLN')`,
      );
      await tx.execute(
        sql`INSERT INTO portfolio.valuations_daily(user_id,account_id,valuation_date,market_value,cash,total_value,total_value_pln,fx_rate_to_pln,as_of)VALUES(${users.pro}::uuid,${account}::uuid,'2026-10-19',3000,1000.5,4000.5,4000.5,1,'2026-10-19T16:00:00Z')`,
      );
      await tx.execute(
        sql`INSERT INTO portfolio.positions_daily(user_id,account_id,instrument_id,valuation_date,quantity,market_value,market_value_pln)VALUES(${users.pro}::uuid,${account}::uuid,${stock}::uuid,'2026-10-19',10,1000,1000),(${users.pro}::uuid,${account}::uuid,${us}::uuid,'2026-10-19',5,2000,2000.004)`,
      );
    });

    // Roles, validation and not-yet-implemented types.
    const basic = await create(monteCarlo, randomUUID(), "basic");
    assert.equal(basic.status, 403);
    assert.equal((await basic.json()).code, "FORBIDDEN");
    assert.equal((await request("runs", "POST", monteCarlo)).status, 422, "Idempotency-Key");
    const bounds = await create({ ...monteCarlo, params: { ...monteCarlo.params, paths: 20000 } });
    assert.equal(bounds.status, 422);
    assert.equal((await bounds.json()).code, "PARAMETERS_OUT_OF_BOUNDS");
    const years = await create({
      ...monteCarlo,
      params: {
        ...monteCarlo.params,
        withdrawals: [
          { amount: { amount: "1", currency: "PLN" }, frequency: "yearly", startYear: 3 },
        ],
      },
    });
    assert.equal(years.status, 422);
    const optimization = await create({
      type: "optimization",
      params: {
        instrumentIds: [stock, us],
        method: "hrp",
        window: { from: "2020-01-01", to: "2025-01-01" },
      },
    });
    assert.equal(optimization.status, 404);
    assert.equal(queued.length, 0);

    // Created run: filled defaults, snapshot from stored valuations, proxies and compliance block.
    const key = randomUUID();
    const created = await create(monteCarlo, key);
    assert.equal(created.status, 202, JSON.stringify(await created.clone().json()));
    assert.match(created.headers.get("location"), /^\/api\/v1\/analytics\/runs\/[0-9a-f-]{36}$/);
    const run = await created.json();
    assert.equal(run.status, "queued");
    assert.equal(run.params.model, "stationary_bootstrap");
    assert.equal(run.params.contributions[0].endYear, 2);
    assert.equal(Number.isInteger(run.params.seed), true);
    assert.deepEqual(run.compliance, {
      disclaimerKey: "analysis",
      disclaimerVersion: "2026-09",
      notInvestmentAdvice: true,
      howToReadKey: "analytics.monte_carlo.how_to_read",
    });
    assert.equal(queued.length, 1);
    const job = queued[0];
    assert.equal(job.runId, run.id);
    assert.deepEqual(job.portfolio.cash, { amount: "1000.50", currency: "PLN" });
    assert.deepEqual(Object.fromEntries(job.portfolio.positions.map((p) => [p.instrumentId, p])), {
      [stock]: {
        instrumentId: stock,
        proxyInstrumentId: proxies.WIG,
        value: { amount: "1000.00", currency: "PLN" },
      },
      [us]: {
        instrumentId: us,
        proxyInstrumentId: proxies["^GSPC"],
        value: { amount: "2000.00", currency: "PLN" },
      },
    });
    assert.equal(job.seed, run.params.seed);

    // Idempotency: same key replays, a different body conflicts, the queue sees one job.
    const replay = await create(monteCarlo, key);
    assert.equal((await replay.json()).id, run.id);
    assert.equal((await create({ ...monteCarlo, params: { horizonYears: 3 } }, key)).status, 409);
    assert.equal(queued.length, 1);

    // Owner isolation and listing without full results.
    assert.equal(
      (await request(`runs/${run.id}`, "GET", undefined, { "x-owner": "other" })).status,
      404,
    );
    assert.equal((await request("runs/not-a-uuid")).status, 404);
    const listed = await (await request("runs?type=monte_carlo&status=queued&limit=1")).json();
    assert.equal(listed.data[0].id, run.id);
    assert.equal(
      (await (await request("runs", "GET", undefined, { "x-owner": "other" })).json()).data.length,
      0,
    );

    // Cancel a waiting run: removed from the queue, terminal, a second cancel conflicts.
    const cancelled = await request(`runs/${run.id}/cancel`, "POST");
    assert.equal(cancelled.status, 202);
    assert.equal((await cancelled.json()).status, "cancelled");
    assert.equal((await request(`runs/${run.id}/cancel`, "POST")).status, 409);

    // Quota of the role (platform.role_limits), counted per Warsaw day.
    await database.transaction({ userId: null, role: "system" }, (tx) =>
      tx.execute(
        sql`INSERT INTO platform.role_limits(role,limits)VALUES('pro','{"analytics_heavy_per_day":2}') ON CONFLICT(role) DO UPDATE SET limits=EXCLUDED.limits`,
      ),
    );
    const limits = await (await request("limits")).json();
    assert.deepEqual(
      { role: limits.role, perDay: limits.heavyRunsPerDay, used: limits.heavyRunsUsedToday },
      { role: "pro", perDay: 2, used: 1 },
    );
    assert.equal(limits.bounds.monteCarloPaths, 10000);
    const second = await (await create(monteCarlo)).json();
    const quota = await create(monteCarlo);
    assert.equal(quota.status, 429);
    assert.equal((await quota.json()).code, "QUOTA_EXCEEDED");

    // jobs: progress and result under the owner's RLS context, idempotent, announced on SSE.
    removable.delete(second.id);
    await request(`runs/${second.id}/cancel`, "POST");
    assert.deepEqual(cancels, [second.id], "a taken job gets the cancel flag");
    await results.handleProgress(second.id, { progress: 40, stage: "simulating" });
    let stored = await (await request(`runs/${second.id}`)).json();
    assert.deepEqual([stored.status, stored.progress], ["running", 40]);
    await results.handleResult(workerResult(second.id));
    stored = await (await request(`runs/${second.id}`)).json();
    assert.equal(stored.status, "done");
    assert.equal(stored.result.kind, "monte_carlo");
    assert.equal(stored.assumptions.historyMonths, 240);
    assert.equal(stored.assumptions.portfolioAsOf, "2026-10-19");
    assert.equal(stored.warnings[0].code, "SHORT_HISTORY");
    assert.deepEqual(stored.reproducibility.libraries, { numpy: "2.5.0" });
    assert.equal(stored.durationMs, 4000);
    await results.handleResult({
      v: 1,
      runId: second.id,
      status: "failed",
      error: { code: "INTERNAL" },
      finishedAt: "2026-10-20T12:00:06.000Z",
      durationMs: 1,
    });
    assert.equal((await (await request(`runs/${second.id}`)).json()).status, "done", "terminal");
    assert.deepEqual(
      published.map((e) => [e.userId, e.event]),
      [
        [users.pro, "analytics.run.progress"],
        [users.pro, "analytics.run.completed"],
      ],
    );

    // A data-quality hold reaches the run with its message; deletion stops later writes.
    await database.transaction({ userId: null, role: "system" }, (tx) =>
      tx.execute(
        sql`UPDATE platform.role_limits SET limits='{"analytics_heavy_per_day":10}' WHERE role='pro'`,
      ),
    );
    const held = await (await create(monteCarlo)).json();
    await results.handleResult({
      v: 1,
      runId: held.id,
      status: "failed",
      error: { code: "DATA_QUALITY_HOLD" },
      finishedAt: "2026-10-20T12:01:00.000Z",
      durationMs: 20,
    });
    const failed = await (await request(`runs/${held.id}`)).json();
    assert.equal(failed.error.code, "DATA_QUALITY_HOLD");
    assert.equal(published.at(-1).data.errorCode, "DATA_QUALITY_HOLD");
    assert.equal((await request(`runs/${held.id}`, "DELETE")).status, 204);
    assert.equal((await request(`runs/${held.id}`)).status, 404);
    await results.handleResult(workerResult(held.id));
    assert.equal(published.at(-1).data.errorCode, "DATA_QUALITY_HOLD", "no event for deleted run");
  } finally {
    await auth.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth.users WHERE id=ANY(${sql.param(Object.values(users))}::uuid[])`,
      );
    });
    await database.transaction({ userId: null, role: "system" }, (tx) =>
      tx.execute(sql`DELETE FROM platform.role_limits WHERE role='pro'`),
    );
    await Promise.all([database.close(), auth.close()]);
  }
}
