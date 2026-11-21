import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { authMailMessages, formatMessage } from "@oliginvest/i18n";
import { copies } from "@oliginvest/i18n/en";
import { symmetricEncrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { executeAdminCommand } from "../dist/auth/admin-commands.js";
import { Administration } from "../dist/auth/administration.js";
import { AuditWriter } from "../dist/auth/audit.js";
import { createAuth } from "../dist/auth/config.js";
import { hashPassword } from "../dist/auth/password.js";
import { SecurityMonitor } from "../dist/auth/security-monitor.js";
import { AuthService } from "../dist/auth/service.js";
import { totpCode } from "../dist/auth/totp.js";
import {
  createSecurityIncidentReporter,
  deliverSecurityIncident,
  isRlsViolation,
  observeRlsViolations,
  recordSecurityIncident,
} from "../dist/modules.js";

// BL-110: synthetic users, documentation-range addresses (RFC 5737), synthetic agents.
const agents = {
  desktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  desktopUpdated:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  phone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

export async function testSecurityEvents(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const appDatabase = createAppDatabase({ ...connection, password: settings.passwords.app });
  const origin = "https://example.test";
  const key = randomBytes(32).toString("hex");
  const audit = new AuditWriter(appDatabase, key);
  const jobs = new Map();
  const notify = async (id, payload) => {
    assert.doesNotMatch(id, /:/u, "BullMQ custom job IDs cannot contain ':'");
    if (!jobs.has(id)) jobs.set(id, payload);
  };
  const delivery = {
    messages: { "pl-PL": authMailMessages, "en-US": copies.authMailMessages },
    formatMessage,
    notify,
  };
  const monitor = new SecurityMonitor({
    appDatabase,
    audit,
    origin,
    notify,
    reportIncident: createSecurityIncidentReporter(appDatabase, key, delivery),
  });
  const user = (role = "user") => ({ userId: randomUUID(), role });
  const [alice, bob, carol, dave, admin, englishAdmin, bannedAdmin] = [
    user(),
    user(),
    user(),
    user(),
    user("admin"),
    user("admin"),
    user("admin"),
  ];
  const client = (ip, userAgent = agents.desktop) => ({ ip, userAgent });
  const auditRows = (actor, action) =>
    appDatabase.transaction(
      actor,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT action,host(ip) AS ip,user_agent,after FROM platform.audit_log WHERE actor_user_id=${actor.userId}::uuid AND (${action ?? null}::text IS NULL OR action=${action ?? null}) ORDER BY occurred_at,id`,
          )
        ).rows,
    );
  const backdate = (actor, action, minutes) =>
    appDatabase.transaction(actor, (tx) =>
      tx.execute(sql`INSERT INTO platform.audit_log(actor_user_id,actor_ref,actor_type,action,outcome,occurred_at)
        VALUES(${actor.userId}::uuid,'synthetic',${actor.role === "admin" ? "admin" : "user"},${action},'success',now()-make_interval(mins => ${minutes}))`),
    );
  const jobsFor = (userId, prefix) =>
    [...jobs.values()].filter(
      (job) => job.userId === userId && job.sourceRef.startsWith(`security:${prefix}`),
    );

  await database.transaction(async (tx) => {
    for (const [index, actor] of [
      alice,
      bob,
      carol,
      dave,
      admin,
      englishAdmin,
      bannedAdmin,
    ].entries())
      await tx.execute(
        sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled,role)
          VALUES(${actor.userId}::uuid,${`Synthetic BL-110 ${index}`},${`${actor.userId}@example.invalid`},true,true,${actor.role})`,
      );
  });
  await appDatabase.transaction(bob, (tx) =>
    tx.execute(
      sql`INSERT INTO identity.user_preferences(user_id,locale,timezone) VALUES(${bob.userId}::uuid,'en-US','UTC')`,
    ),
  );

  await database.transaction((tx) =>
    tx.execute(sql`UPDATE auth.users SET banned=true WHERE id=${bannedAdmin.userId}::uuid`),
  );
  await appDatabase.transaction(englishAdmin, (tx) =>
    tx.execute(
      sql`INSERT INTO identity.user_preferences(user_id,locale,timezone) VALUES(${englishAdmin.userId}::uuid,'en-US','UTC')`,
    ),
  );

  // 1. Failed sign-in series: threshold 5 in 15 min, one e-mail per hour, concurrency-safe.
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      monitor.signInFailed(alice, client("192.0.2.10"), index % 3 === 0 ? "totp" : "password"),
    ),
  );
  const series = jobsFor(alice.userId, "failed-sign-in");
  assert.equal(series.length, 1, "Twelve concurrent failures produce exactly one alert");
  assert.equal(series[0].kind, "security");
  assert.deepEqual(series[0].channels, ["email"]);
  assert.equal(series[0].subject, "OligInvest — seria nieudanych prób logowania");
  assert.match(series[0].text, /Liczba prób w ostatnich 15 min: 5\n/u);
  assert.match(series[0].text, /https:\/\/example\.test\/ustawienia/u);
  assert.equal((await auditRows(alice, "security.failed_sign_in_series")).length, 1);
  assert.equal((await auditRows(alice, "auth.sign_in_failed")).length, 8);
  assert.equal((await auditRows(alice, "auth.2fa_failed")).length, 4);
  assert.equal((await auditRows(alice, "auth.2fa_failed"))[0].ip, "192.0.2.10");
  await monitor.signInFailed(alice, client("192.0.2.10"), "password");
  assert.equal(jobsFor(alice.userId, "failed-sign-in").length, 1, "Cooldown holds");

  // Failures outside the window do not count; an alert older than the cooldown does not block.
  for (let index = 0; index < 5; index += 1) await backdate(carol, "auth.sign_in_failed", 20);
  await monitor.signInFailed(carol, client("192.0.2.20"), "password");
  assert.equal(jobsFor(carol.userId, "failed-sign-in").length, 0, "Stale failures ignored");
  await backdate(carol, "security.failed_sign_in_series", 61);
  for (let index = 0; index < 3; index += 1) await backdate(carol, "auth.sign_in_failed", 5);
  await monitor.signInFailed(carol, client("192.0.2.20"), "password");
  assert.equal(jobsFor(carol.userId, "failed-sign-in").length, 1, "Alert after cooldown");

  // RLS: another account's series never counts for Bob, and Bob cannot read it.
  await monitor.signInFailed(bob, client("192.0.2.10"), "password");
  assert.equal(jobsFor(bob.userId, "failed-sign-in").length, 0);
  const foreign = await appDatabase.transaction(
    bob,
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT count(*)::int AS count FROM platform.audit_log WHERE actor_user_id=${alice.userId}::uuid`,
        )
      ).rows[0].count,
  );
  assert.equal(foreign, 0, "Bob sees none of Alice's security events");

  // BL-110b: stale failures and foreign accounts cannot bring the step-up count to five.
  for (let index = 0; index < 5; index += 1) await backdate(bob, "auth.step_up_failed", 16);
  for (let index = 0; index < 4; index += 1) await monitor.stepUpFailed(bob);
  assert.equal(jobsFor(bob.userId, "failed-step-up").length, 0);
  await monitor.stepUpFailed(alice);
  assert.equal(jobsFor(alice.userId, "failed-step-up").length, 0);
  await Promise.all(Array.from({ length: 6 }, () => monitor.stepUpFailed(bob)));
  const stepUp = jobsFor(bob.userId, "failed-step-up");
  assert.equal(stepUp.length, 1, "Concurrent fifth attempts generate one step-up alert");
  assert.equal(stepUp[0].subject, "OligInvest — repeated failed TOTP confirmations");
  assert.match(stepUp[0].text, /last 15 min: 5/u);
  assert.equal((await auditRows(bob, "security.failed_step_up_series")).length, 1);
  assert.equal((await auditRows(alice, "security.failed_step_up_series")).length, 0);

  // The real FORCE RLS error survives rollback; reporting uses a separate transaction.
  const incidents = [];
  const monitored = observeRlsViolations(
    appDatabase,
    async (context) => {
      const event = await recordSecurityIncident(appDatabase, key, context, "rls");
      incidents.push(event);
      await deliverSecurityIncident(appDatabase, event, delivery);
    },
    () => assert.fail("RLS reporting must succeed"),
  );
  await assert.rejects(
    () =>
      monitored.transaction(bob, (tx) =>
        tx.execute(sql`
    INSERT INTO identity.user_preferences(user_id) VALUES (${alice.userId}::uuid)`),
      ),
    isRlsViolation,
  );
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].kind, "rls");
  assert.equal((await auditRows(bob, "security.rls_violation")).length, 1);
  assert.deepEqual((await auditRows(bob, "security.rls_violation"))[0].after, { kind: "rls" });
  const invisible = await appDatabase.transaction(
    alice,
    async (tx) =>
      (
        await tx.execute(sql`SELECT count(*)::int AS count FROM platform.audit_log
      WHERE action='security.rls_violation' AND actor_user_id=${bob.userId}::uuid`)
      ).rows[0].count,
  );
  assert.equal(invisible, 0, "Another account cannot see the incident");

  const rlsMail = jobsFor(admin.userId, "incident");
  assert.equal(rlsMail.length, 1);
  assert.match(rlsMail[0].subject, /SEV1: naruszenie RLS/u);
  assert.match(jobsFor(englishAdmin.userId, "incident")[0].subject, /SEV1: RLS violation/u);
  assert.equal(jobsFor(bannedAdmin.userId, "incident").length, 0);
  assert.equal(jobsFor(bob.userId, "incident").length, 0);
  const incidentCount = jobs.size;
  await deliverSecurityIncident(appDatabase, incidents[0], delivery);
  assert.equal(jobs.size, incidentCount, "Replayed delivery retains recipient job IDs");
  const committed = await appDatabase.transaction(
    alice,
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT count(*)::int AS count FROM identity.user_preferences WHERE user_id=${alice.userId}::uuid`,
        )
      ).rows[0].count,
  );
  assert.equal(committed, 0, "The offending insert was rolled back");
  for (const kind of ["role", "flag", "limits", "reset-2fa", "email"])
    await monitor.administrativeChanged(admin, kind);
  assert.equal(
    jobsFor(admin.userId, "incident").length,
    6,
    "Each administrative change sends an alert",
  );
  assert.equal(jobsFor(englishAdmin.userId, "incident").length, 6);
  // BL-509: an administrator's e-mail change names the change in each recipient's language.
  assert.ok(
    jobsFor(englishAdmin.userId, "incident").some((job) =>
      job.text.includes(copies.authMailMessages.securityChangeEmail),
    ),
  );
  assert.ok(
    jobsFor(admin.userId, "incident").some((job) =>
      job.text.includes(authMailMessages.securityChangeEmail),
    ),
  );
  assert.equal(jobsFor(bannedAdmin.userId, "incident").length, 0);
  const deliveredTo = [];
  await assert.rejects(
    () =>
      deliverSecurityIncident(appDatabase, incidents[0], {
        ...delivery,
        notify: async (_id, payload) => {
          deliveredTo.push(payload.userId);
          if (payload.userId === admin.userId) throw new Error("Synthetic queue outage");
        },
      }),
    /SECURITY_INCIDENT_DELIVERY_FAILED/u,
  );
  assert.ok(
    deliveredTo.includes(englishAdmin.userId),
    "One recipient failure does not suppress the others",
  );

  // 2. New device: first sign-in is a baseline, version updates and the same /24 are known.
  await monitor.signedIn(bob, client("192.0.2.30", agents.desktop));
  await monitor.signedIn(bob, client("192.0.2.31", agents.desktopUpdated));
  assert.equal(jobsFor(bob.userId, "new-device").length, 0);
  await monitor.signedIn(bob, client("198.51.100.7", agents.desktop));
  const device = jobsFor(bob.userId, "new-device");
  assert.equal(device.length, 1, "Same browser from a new network is a new device");
  assert.equal(device[0].subject, "OligInvest — new sign-in to your account");
  assert.match(device[0].text, /Browser and system: chrome \/ windows\n/u);
  assert.match(device[0].text, /Approximate network: 198\.51\.100\.0\/24\n/u);
  assert.doesNotMatch(device[0].text, /198\.51\.100\.7/u, "Full address never in e-mail");
  assert.match(device[0].text, /\(UTC\)/u);
  await monitor.signedIn(bob, client("198.51.100.8", agents.desktop));
  await monitor.signedIn(bob, client("192.0.2.30", agents.phone));
  assert.equal(jobsFor(bob.userId, "new-device").length, 2, "A new browser is a new device");
  assert.equal((await auditRows(bob, "session.new_device")).length, 2);
  assert.equal((await auditRows(bob, "auth.sign_in")).length, 5);

  // 3. Mass export (BL-114 extension point): > 3 a day, or export + new PAT + new device in 1 h.
  for (let index = 0; index < 3; index += 1)
    assert.deepEqual(await monitor.exportRequested(dave, client("192.0.2.40")), {
      anomaly: null,
      requireStepUp: false,
    });
  assert.deepEqual(await monitor.exportRequested(dave, client("192.0.2.40")), {
    anomaly: "volume",
    requireStepUp: true,
  });
  await monitor.exportRequested(dave, client("192.0.2.40"));
  const exportAlerts = [...jobs.values()].filter((job) =>
    job.sourceRef.startsWith("security:mass-export:"),
  );
  assert.equal(exportAlerts.filter((job) => job.userId === admin.userId).length, 1);
  assert.ok(
    exportAlerts.every((job) => job.userId !== dave.userId),
    "Only administrators",
  );
  assert.match(exportAlerts[0].text, new RegExp(dave.userId, "u"));
  assert.equal((await auditRows(dave, "security.mass_export")).length, 1, "One alert a day");
  await backdate(carol, "pat.create", 30);
  await backdate(carol, "session.new_device", 10);
  assert.deepEqual(await monitor.exportRequested(carol, client("192.0.2.20")), {
    anomaly: "combination",
    requireStepUp: true,
  });

  // 4. Recovery e-mails deduplicate by event.
  const recovery = {
    userId: alice.userId,
    kind: "two_factor_recovered",
    occurredAt: new Date().toISOString(),
  };
  await monitor.twoFactorRecovery(alice, recovery);
  await monitor.twoFactorRecovery(alice, recovery);
  assert.equal(jobsFor(alice.userId, "recovery").length, 1);

  // Security e-mails carry facts only: no amounts, currencies or investment wording.
  await monitor.rlsViolation(bob);
  assert.equal((await auditRows(bob, "security.rls_violation")).length, 2);
  for (const job of jobs.values()) {
    assert.doesNotMatch(job.text, /\b(PLN|USD|EUR)\b|zł/u);
    assert.doesNotMatch(job.text, /\b(kup|sprzedaj|buy|sell)\b/iu);
  }

  await testFacadeWiring({ database, appDatabase, audit });
  await Promise.all([database.close(), appDatabase.close()]);
}

/** The auth facade feeds the monitor: password and TOTP failures, completed logins. */
async function testFacadeWiring({ database, appDatabase, audit }) {
  const configuration = {
    origin: "https://example.test",
    secrets: [{ version: 1, value: randomBytes(32).toString("hex") }],
    trustedProxies: [],
    sendReset: async () => {},
  };
  const jobs = [];
  const steps = new Map();
  const service = new AuthService({
    database,
    appDatabase,
    configuration,
    state: {
      limit: async () => {},
      failures: async () => 0,
      failed: async () => {},
      succeeded: async () => {},
      consumeStep: async (id, step) => {
        if ((steps.get(id) ?? -1) >= step) return false;
        steps.set(id, step);
        return true;
      },
    },
    passwordChecks: { compromised: async () => false, unavailable: () => {} },
    wait: async () => {},
    event: () => {},
    audit,
    securityEvent: async () => {},
    securityMonitor: new SecurityMonitor({
      appDatabase,
      audit,
      origin: configuration.origin,
      notify: async (_id, payload) => jobs.push(payload),
      reportIncident: createSecurityIncidentReporter(appDatabase, configuration.secrets[0].value, {
        messages: { "pl-PL": authMailMessages, "en-US": copies.authMailMessages },
        formatMessage,
        notify: async (_id, payload) => jobs.push(payload),
      }),
    }),
  });
  const userId = randomUUID();
  const email = `${userId}@example.invalid`;
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(20).toString("hex");
  await database.transaction(async (tx) => {
    const { secretConfig } = await createAuth(tx, configuration).$context;
    await tx.execute(sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled)
      VALUES(${userId}::uuid,'Synthetic BL-110 facade',${email},true,true)`);
    await tx.execute(sql`INSERT INTO auth.accounts(account_id,provider_id,user_id,password)
      VALUES(${userId},'credential',${userId}::uuid,${await hashPassword(password)})`);
    await tx.execute(sql`INSERT INTO auth.two_factors(secret,backup_codes,user_id,verified)
      VALUES(${await symmetricEncrypt({ key: secretConfig, data: secret })},
        ${await symmetricEncrypt({ key: secretConfig, data: JSON.stringify(["aaaaa-bbbbb"]) })},
        ${userId}::uuid,true)`);
  });
  const actor = { userId, role: "user" };
  const post = (path, body, ip, cookie = "") =>
    service.handle(
      new Request(`${configuration.origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          origin: configuration.origin,
          "content-type": "application/json",
          "user-agent": agents.desktop,
          cookie,
        },
        body: JSON.stringify(body),
      }),
      ip,
    );
  const rejects = (run) => assert.rejects(run, (error) => error.code === "UNAUTHENTICATED");
  const actions = async () =>
    (
      await appDatabase.transaction(
        actor,
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT action,host(ip) AS ip,user_agent FROM platform.audit_log WHERE actor_user_id=${userId}::uuid ORDER BY occurred_at,id`,
            )
          ).rows,
      )
    ).map((row) => row.action);
  const signIn = async (ip) => {
    const response = await post("/sign-in/email", { email, password }, ip);
    assert.deepEqual(await response.json(), { twoFactorRedirect: true });
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  };

  await rejects(() =>
    post("/sign-in/email", { email, password: "wrong-password-1" }, "192.0.2.50"),
  );
  await rejects(() =>
    post("/sign-in/email", { email: `${randomUUID()}@example.invalid`, password }, "192.0.2.99"),
  );
  let challenge = await signIn("192.0.2.50");
  await rejects(() => post("/two-factor/verify-totp", { code: "000000" }, "192.0.2.50", challenge));
  const code = () => totpCode(secret, Math.floor(Date.now() / 30_000));
  await post("/two-factor/verify-totp", { code: code() }, "192.0.2.50", challenge);
  await service.settleSecurityEvents();
  assert.deepEqual(await actions(), ["auth.sign_in_failed", "auth.2fa_failed", "auth.sign_in"]);
  const unknown = await appDatabase.transaction(
    { userId: null, role: "system" },
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT count(*)::int AS count FROM platform.audit_log WHERE ip='192.0.2.99'::inet`,
        )
      ).rows[0].count,
  );
  assert.equal(unknown, 0, "Unknown accounts leave no per-account security events");
  assert.equal(jobs.length, 0, "Baseline login and two failures send nothing");

  challenge = await signIn("203.0.113.5");
  steps.clear(); // replay protection is covered by the facade test; reuse the current step
  await post("/two-factor/verify-totp", { code: code() }, "203.0.113.5", challenge);
  // Separate addresses keep Better Auth's per-IP sign-in limiter out of the way; the
  // series is per account, whatever the address.
  for (let index = 0; index < 3; index += 1)
    await rejects(() =>
      post(
        "/sign-in/email",
        { email, password: `wrong-password-${index}` },
        `203.0.113.${10 + index}`,
      ),
    );
  await service.settleSecurityEvents();
  assert.deepEqual(jobs.map((job) => job.sourceRef.split(":")[1]).sort(), [
    "failed-sign-in",
    "new-device",
  ]);

  // A real authenticated session: invalid TOTP commits its counter before the monitor runs.
  steps.clear();
  challenge = await signIn([192, 0, 2, 77].join("."));
  const signedIn = await post(
    "/two-factor/verify-totp",
    { code: code() },
    [192, 0, 2, 77].join("."),
    challenge,
  );
  let sessionCookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const request = () =>
    new Request(`${configuration.origin}/api/v1/auth/step-up`, {
      method: "POST",
      headers: { origin: configuration.origin, cookie: sessionCookie },
    });
  const invalid = "invalid-code";
  for (let index = 0; index < 4; index += 1)
    await rejects(() => service.stepUp(request(), invalid));
  await service.settleSecurityEvents();
  assert.equal(
    jobs.filter((job) => job.sourceRef.startsWith("security:failed-step-up:")).length,
    0,
  );
  await rejects(() => service.stepUp(request(), invalid));
  await assert.rejects(
    () => service.stepUp(request(), code()),
    (error) => error.code === "RATE_LIMITED",
  );
  await service.settleSecurityEvents();
  assert.equal((await actions()).filter((action) => action === "auth.step_up_failed").length, 5);
  const alerts = jobs.filter((job) => job.sourceRef.startsWith("security:failed-step-up:"));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /nieudanych potwierdzeń TOTP/u);
  const lock = await database.transaction(
    async (tx) =>
      (
        await tx.execute(sql`SELECT
    failed_verification_count AS failures, locked_until > now() AS locked
    FROM auth.two_factors WHERE user_id=${userId}::uuid`)
      ).rows[0],
  );
  assert.deepEqual(lock, { failures: 5, locked: true });
  // Expiry is simulated in PostgreSQL; no waits, retries, or weakened limits.
  await database.transaction((tx) =>
    tx.execute(sql`UPDATE auth.two_factors
    SET locked_until=now()-interval '1 second' WHERE user_id=${userId}::uuid`),
  );
  steps.clear();
  const previousCookie = sessionCookie;
  const confirmed = await service.stepUp(request(), code());
  sessionCookie = confirmed.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.notEqual(sessionCookie, previousCookie, "Step-up rotates the session");
  await service.settleSecurityEvents();
  assert.equal((await actions()).filter((action) => action === "auth.step_up").length, 1);
  const administration = new Administration(service, {
    resetMail: async () => {},
    emailChangedMail: async () => {},
    inviteMail: async () => {},
    flagsChanged: async () => {},
    queues: async () => {},
  });
  const beforeIncidents = () =>
    jobs.filter((job) => job.sourceRef.startsWith("security:incident:"));
  assert.equal(beforeIncidents().length, 0);
  await assert.rejects(
    () =>
      executeAdminCommand(administration, {
        command: "flag",
        key: "module.identity",
        action: "off",
        reason: "Synthetic denied mutation",
      }),
    (error) => error.code === "FORBIDDEN",
  );
  await service.settleSecurityEvents();
  assert.equal(beforeIncidents().length, 0, "Denied changes send no success alert");
  const flag = await appDatabase.transaction(
    { userId: null, role: "system" },
    async (tx) =>
      (
        await tx.execute(
          sql`SELECT enabled,rules FROM platform.feature_flags WHERE key='module.analytics'`,
        )
      ).rows[0],
  );
  try {
    await executeAdminCommand(administration, {
      command: "flag",
      key: "module.analytics",
      action: flag.enabled ? "off" : "on",
      reason: "Synthetic BL-110b flag change",
    });
    await service.settleSecurityEvents();
    assert.ok(beforeIncidents().length > 0, "Committed CLI flag change alerts administrators");
    const firstIds = new Set(beforeIncidents().map((job) => job.sourceRef));
    await executeAdminCommand(administration, {
      command: "reset-2fa",
      email,
      reason: "Synthetic BL-110b reset",
    });
    await service.settleSecurityEvents();
    assert.equal(new Set(beforeIncidents().map((job) => job.sourceRef)).size, firstIds.size + 1);
  } finally {
    await appDatabase.transaction({ userId: null, role: "system" }, (tx) =>
      tx.execute(
        sql`UPDATE platform.feature_flags SET enabled=${flag.enabled},rules=${JSON.stringify(flag.rules)}::jsonb WHERE key='module.analytics'`,
      ),
    );
  }
}
