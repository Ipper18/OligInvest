import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

export async function testAdminStress({
  app,
  administration,
  database,
  appDatabase,
  cookies,
  userId,
}) {
  const actor = { userId, role: "admin" };
  const service = administration.service;
  const historical = {
    name: "Syntetyczny kryzys",
    kind: "historical",
    description: "Okno testowe",
    startDate: "2020-01-01",
    endDate: "2023-01-01",
    enabled: true,
  };
  const key = "itest_admin_stress";
  const call = async (body = historical, headers = {}, scenarioKey = key) => {
    const requestId = randomUUID();
    const response = await app.request(`/api/v1/admin/analytics/stress-scenarios/${scenarioKey}`, {
      method: "PUT",
      headers: {
        origin: service.options.configuration.origin,
        "content-type": "application/json",
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        "x-request-id": requestId,
        "user-agent": "Synthetic stress configuration test",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const data = await response.json();
    const audit = await appDatabase.transaction(
      actor,
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT actor_user_id,actor_type,action,outcome,resource_id,resource_type,before,after,
        host(ip) AS ip,user_agent,occurred_at
      FROM platform.audit_log WHERE request_id=${requestId}
      AND action='admin.stress_scenario.upsert'`)
        ).rows,
    );
    assert.equal(audit.length, 1, `Exactly one outcome audit: ${JSON.stringify(data)}`);
    assert.equal(audit[0].ip, "192.0.2.1");
    assert.equal(audit[0].user_agent, "Synthetic stress configuration test");
    assert.ok(audit[0].occurred_at);
    return { response, data, audit: audit[0] };
  };
  const denied = async (body, headers, code, status = 403, scenarioKey) => {
    const result = await call(body, headers, scenarioKey);
    assert.equal(result.response.status, status, JSON.stringify(result.data));
    assert.equal(result.data.code, code);
    assert.match(result.response.headers.get("content-type"), /^application\/problem\+json/u);
    assert.equal(result.audit.outcome, "denied");
  };
  const flag = await appDatabase.transaction(
    actor,
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT enabled,rules FROM platform.feature_flags WHERE key='module.analytics'`,
        )
      ).rows[0],
  );
  const setFlag = async (enabled) => {
    await appDatabase.transaction(actor, (tx) =>
      tx.execute(sql`
      UPDATE platform.feature_flags SET enabled=${enabled},rules='{}'::jsonb WHERE key='module.analytics'`),
    );
    service.features.invalidate();
  };
  const session = await database.transaction(
    async (tx) =>
      (
        await tx.execute(sql`
    SELECT mfa_verified_at,mfa_method FROM auth.sessions WHERE user_id=${userId}::uuid`)
      ).rows[0],
  );
  const restoreSession = () =>
    database.transaction((tx) =>
      tx.execute(sql`
    UPDATE auth.sessions SET mfa_verified_at=${session.mfa_verified_at},mfa_method=${session.mfa_method}
    WHERE user_id=${userId}::uuid`),
    );
  try {
    await setFlag(true);
    await denied(historical, { cookie: "" }, "UNAUTHENTICATED", 401);
    await denied(historical, { authorization: "Bearer synthetic-pat" }, "FORBIDDEN");
    await denied(historical, { origin: "https://other.example.test" }, "FORBIDDEN");
    for (const role of ["user", "pro"]) {
      await database.transaction((tx) =>
        tx.execute(sql`UPDATE auth.users SET role=${role} WHERE id=${userId}::uuid`),
      );
      await denied(historical, {}, "FORBIDDEN");
      await assert.rejects(
        () =>
          appDatabase.transaction({ userId, role }, (tx) =>
            tx.execute(sql`
        INSERT INTO analytics.stress_scenarios(key,name,kind,description,shocks)
        VALUES (${key},'Synthetic','hypothetical','Synthetic','{}'::jsonb)`),
          ),
        (error) => (error.cause ?? error).code === "42501",
      );
    }
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET role='admin' WHERE id=${userId}::uuid`),
    );
    await database.transaction((tx) =>
      tx.execute(sql`
      UPDATE auth.sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE user_id=${userId}::uuid`),
    );
    await denied(historical, {}, "STEP_UP_REQUIRED");
    await database.transaction((tx) =>
      tx.execute(sql`
      UPDATE auth.sessions SET mfa_verified_at=now(),mfa_method='backup' WHERE user_id=${userId}::uuid`),
    );
    await denied(historical, {}, "STEP_UP_REQUIRED");
    await database.transaction((tx) =>
      tx.execute(sql`
      UPDATE auth.sessions SET mfa_verified_at=NULL WHERE user_id=${userId}::uuid`),
    );
    await denied(historical, {}, "MFA_REQUIRED");
    await restoreSession();
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET two_factor_enabled=false WHERE id=${userId}::uuid`),
    );
    await denied(historical, {}, "MFA_ENROLLMENT_REQUIRED");
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET two_factor_enabled=true WHERE id=${userId}::uuid`),
    );
    const terms = await appDatabase.transaction(
      actor,
      async (tx) =>
        (
          await tx.execute(sql`SELECT version FROM identity.consent_events WHERE document='terms'
        ORDER BY recorded_at DESC,id DESC LIMIT 1`)
        ).rows[0],
    );
    const acceptTerms = (version) =>
      appDatabase.transaction(actor, (tx) =>
        tx.execute(sql`
      INSERT INTO identity.consent_events(user_id,document,version,action,source)
      VALUES (${userId}::uuid,'terms',${version},'accepted','gate')`),
      );
    await acceptTerms("2000-01");
    try {
      await denied(historical, {}, "TERMS_ACCEPTANCE_REQUIRED");
    } finally {
      await acceptTerms(terms.version);
    }
    await setFlag(false);
    await denied(historical, {}, "NOT_FOUND", 404);
    await setFlag(true);
    for (const body of [
      "{",
      " ".repeat(16_385),
      { ...historical, endDate: "2023-01-02" },
      { ...historical, endDate: "2020-01-01" },
      { ...historical, extra: true },
      { ...historical, shocks: { items: [] } },
      {
        name: "Szok",
        kind: "hypothetical",
        description: "Test",
        enabled: true,
        shocks: { items: [{ kind: "fx_shock", currency: "PLN", shock: 0.1 }] },
      },
    ])
      await denied(body, {}, "VALIDATION_FAILED", 422);
    await denied(historical, {}, "VALIDATION_FAILED", 422, "INVALID");
    const created = await call();
    assert.equal(created.response.status, 200, JSON.stringify(created.data));
    assert.equal(created.audit.actor_user_id, userId);
    assert.equal(created.audit.actor_type, "admin");
    assert.equal(created.audit.resource_type, "stress_scenario");
    assert.equal(created.audit.resource_id, key);
    assert.equal(created.audit.before, null);
    assert.deepEqual(created.audit.after, { stressScenario: created.data });
    const changed = await call({ ...historical, enabled: false });
    assert.equal(changed.response.status, 200);
    assert.deepEqual(changed.audit.before, created.audit.after);
    assert.equal(changed.audit.after.stressScenario.enabled, false);
    const repeated = await call({ ...historical, enabled: false });
    assert.deepEqual(repeated.data, changed.data);
    assert.deepEqual(repeated.audit.before, repeated.audit.after);
    const hypothetical = {
      name: "Szoki",
      kind: "hypothetical",
      description: "Test",
      enabled: true,
      shocks: {
        items: [{ kind: "fx_shock", currency: "USD", shock: -0.2 }, { kind: "correlation_shock" }],
      },
    };
    const converted = await call(hypothetical);
    assert.equal(converted.response.status, 200);
    assert.equal(converted.data.startDate, undefined);
    assert.deepEqual(converted.audit.before, changed.audit.after);
    const row = await appDatabase.transaction(
      actor,
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT start_date,end_date,updated_by,updated_at FROM analytics.stress_scenarios WHERE key=${key}`)
        ).rows[0],
    );
    assert.equal(row.start_date, null);
    assert.equal(row.end_date, null);
    assert.equal(row.updated_by, userId);
    assert.ok(row.updated_at);
    for (const role of ["user", "pro"]) {
      const result = await appDatabase.transaction({ userId, role }, (tx) =>
        tx.execute(sql`
        UPDATE analytics.stress_scenarios SET enabled=false WHERE key=${key} RETURNING key`),
      );
      assert.equal(result.rows.length, 0);
    }
    await assert.rejects(
      () =>
        database.transaction((tx) => tx.execute(sql`SELECT key FROM analytics.stress_scenarios`)),
      (error) => (error.cause ?? error).code === "42501",
    );
    // A failed success-audit rolls the scenario back; started/error events remain durable.
    const writer = service.options.audit;
    const original = writer.recordInTransaction;
    writer.recordInTransaction = async function (tx, context, event) {
      if (event.action === "admin.stress_scenario.upsert" && event.outcome === "success")
        throw new Error("Synthetic audit failure");
      return original.call(this, tx, context, event);
    };
    try {
      const failed = await call(historical);
      assert.equal(failed.response.status, 500);
      assert.equal(failed.audit.outcome, "error");
    } finally {
      writer.recordInTransaction = original;
    }
    const afterFailure = await call(hypothetical);
    assert.deepEqual(afterFailure.audit.before, converted.audit.after);
    const concurrent = await Promise.all([
      call(historical, {}, `${key}_new`),
      call({ ...historical, enabled: false }, {}, `${key}_new`),
    ]);
    assert.ok(concurrent.every((result) => result.response.status === 200));
    const first = concurrent.find((result) => result.audit.before === null);
    assert.ok(first);
    const second = concurrent.find((result) => result !== first);
    assert.deepEqual(second.audit.before, first.audit.after);
  } finally {
    await restoreSession();
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET role='admin' WHERE id=${userId}::uuid`),
    );
    await appDatabase.transaction(actor, async (tx) => {
      await tx.execute(
        sql`DELETE FROM analytics.stress_scenarios WHERE key IN (${key},${`${key}_new`})`,
      );
      await tx.execute(
        sql`UPDATE platform.feature_flags SET enabled=${flag.enabled},rules=${JSON.stringify(flag.rules)}::jsonb WHERE key='module.analytics'`,
      );
    });
    service.features.invalidate();
  }
}
