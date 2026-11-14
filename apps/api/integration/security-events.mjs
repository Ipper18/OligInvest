import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { symmetricEncrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { AuditWriter } from "../dist/auth/audit.js";
import { createAuth } from "../dist/auth/config.js";
import { hashPassword } from "../dist/auth/password.js";
import { SecurityMonitor } from "../dist/auth/security-monitor.js";
import { AuthService } from "../dist/auth/service.js";
import { totpCode } from "../dist/auth/totp.js";

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
  const monitor = new SecurityMonitor({
    appDatabase,
    audit,
    origin,
    notify: async (id, payload) => {
      assert.doesNotMatch(id, /:/u, "BullMQ custom job IDs cannot contain ':'");
      if (!jobs.has(id)) jobs.set(id, payload);
    },
  });
  const user = (role = "user") => ({ userId: randomUUID(), role });
  const [alice, bob, carol, dave, admin] = [user(), user(), user(), user(), user("admin")];
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
    for (const [index, actor] of [alice, bob, carol, dave, admin].entries())
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
}
