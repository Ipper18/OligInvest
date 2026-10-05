import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { symmetricDecrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";
import { executeAdminCommand } from "../dist/auth/admin-commands.js";
import { Administration } from "../dist/auth/administration.js";
import { AuditWriter } from "../dist/auth/audit.js";
import { createAuth } from "../dist/auth/config.js";
import { authOperations } from "../dist/auth/routes.js";
import { AuthService } from "../dist/auth/service.js";
import { SESSION_COOKIE, sessionCookie } from "../dist/auth/session.js";
import { totpCode } from "../dist/auth/totp.js";

export async function testAuthFacade(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const appDatabase = createAppDatabase({ ...connection, password: settings.passwords.app });
  const configuration = {
    origin: "https://example.test",
    secrets: [{ version: 1, value: randomBytes(32).toString("hex") }],
    trustedProxies: [],
    sendReset: async (message) => {
      mail.push(message);
    },
  };
  const mail = [];
  const steps = new Map();
  const failures = new Map();
  const delays = [];
  const events = [];
  const securityEvents = [];
  const state = {
    limit: async () => {},
    failures: async (email) => failures.get(email) ?? 0,
    failed: async (email) => failures.set(email, (failures.get(email) ?? 0) + 1),
    succeeded: async (email) => failures.delete(email),
    consumeStep: async (id, step) => {
      if ((steps.get(id) ?? -1) >= step) return false;
      steps.set(id, step);
      return true;
    },
  };
  const service = new AuthService({
    database,
    appDatabase,
    configuration,
    state,
    passwordChecks: { compromised: async () => false, unavailable: () => {} },
    wait: async (ms) => delays.push(ms),
    event: (event) => events.push(event),
    audit: new AuditWriter(appDatabase, configuration.secrets[0].value),
    securityEvent: async (event) => securityEvents.push(event),
  });
  const cookies = new Map();
  const invitations = [];
  const resets = [];
  const queueActions = [];
  const administration = new Administration(service, {
    resetMail: async (message) => resets.push(message),
    inviteMail: async (message) => invitations.push(message),
    flagsChanged: async () => service.features.invalidate(),
    queues: async (...args) => queueActions.push(args),
  });
  const app = createApp({
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: configuration.origin,
    checks: { postgres: async () => {}, valkeyQueue: async () => {}, valkeyCache: async () => {} },
    auth: {
      service: () => service,
      administration: () => administration,
      clientIp: () => "192.0.2.1",
    },
  });
  // Test-only target proves the production module guard runs before dispatch.
  app.get("/api/v1/analytics/synthetic-probe", (context) => context.json({ ok: true }));
  const request = (path, body, jar = cookies) =>
    new Request(`${configuration.origin}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: configuration.origin,
        "content-type": "application/json",
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function call(path, body, jar = cookies) {
    const response = await app.fetch(request(path, body, jar));
    if (response.status >= 400) {
      assert.match(response.headers.get("content-type"), /^application\/problem\+json/u);
      const problem = await response.json();
      assert.equal(problem.status, response.status);
      assert.ok(response.headers.get("x-request-id"));
      throw new ProblemError(problem.code);
    }
    assert.equal(response.status, 200, path);
    for (const cookie of response.headers.getSetCookie()) {
      assert.match(cookie, /^__Host-oliginvest\./u);
      assert.match(cookie, /; Secure/iu);
      assert.match(cookie, /; HttpOnly/iu);
      assert.doesNotMatch(cookie, /; Domain=/iu);
      const pair = cookie.split(";")[0];
      const at = pair.indexOf("=");
      if (/Max-Age=0/iu.test(cookie)) jar.delete(pair.slice(0, at));
      else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }
  const denied = (run, code) => assert.rejects(run, (error) => error.code === code);
  const identity = (path, body, extra = {}) =>
    app.request(`/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        origin: configuration.origin,
        "content-type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const password = randomBytes(24).toString("hex");
  const email = `${randomUUID()}@example.test`;
  const invitationToken = randomBytes(32).toString("base64url");
  let ownerId;
  let userId;
  try {
    const nativePaths = await database.transaction(async (tx) => {
      const native = createAuth(tx, configuration);
      await native.$context;
      return [
        ...new Set(
          Object.values(native.api)
            .map((endpoint) => endpoint.path)
            .filter(Boolean),
        ),
      ];
    });
    const exposed = new Set(authOperations.map(([path]) => path));
    assert.ok(nativePaths.includes("/two-factor/disable"));
    for (const path of nativePaths.filter((path) => !exposed.has(path))) {
      const concrete = path.replace(/:[a-zA-Z]+/gu, "synthetic");
      const response = await app.fetch(request(concrete, {}));
      assert.equal(response.status, 403, `Native route must be blocked: ${path}`);
    }

    // Every mounted auth operation must reject a bearer token, including public routes.
    for (const [path] of authOperations) {
      const raw = request(path, ["/get-session", "/list-sessions"].includes(path) ? undefined : {});
      raw.headers.set("authorization", "Bearer synthetic-forbidden");
      const response = await app.fetch(raw);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).code, "FORBIDDEN");
    }
    const forbiddenStepUp = await app.request("/api/v1/me/step-up", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer synthetic-forbidden",
        origin: configuration.origin,
      },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(forbiddenStepUp.status, 403);
    ownerId = await database.transaction(async (tx) => {
      const response = await createAuth(tx, configuration).handler(
        request(
          "/sign-up/email",
          { email: `${randomUUID()}@example.test`, name: "Owner fixture", password },
          new Map(),
        ),
      );
      assert.equal(response.status, 200);
      return (await response.json()).user.id;
    });
    await appDatabase.transaction({ userId: ownerId, role: "admin" }, (tx) =>
      tx.execute(sql`
      INSERT INTO identity.invitations(email,role,token_hash,invited_by,expires_at)
      VALUES (${email},'pro',${createHash("sha256").update(invitationToken).digest("hex")},${ownerId}::uuid,now()+interval '1 hour')`),
    );
    const signup = {
      email,
      name: "Synthetic",
      password,
      invitationToken,
      acceptTerms: true,
      termsVersion: "2026-09",
      privacyNoticeVersion: "2026-09",
    };
    await denied(
      () => call("/sign-up/email", { ...signup, invitationToken: "a".repeat(43) }),
      "FORBIDDEN",
    );
    const created = await (await call("/sign-up/email", signup)).json();
    userId = created.user.id;
    assert.equal(created.user.role, "pro");
    assert.equal(created.user.emailVerified, true);
    assert.equal(created.session.mfaVerifiedAt, null);
    const meBeforeMfa = await identity("/me");
    assert.equal(meBeforeMfa.status, 200);
    assert.equal((await meBeforeMfa.json()).mfa.enrolled, false);
    for (const [path, body] of [
      ["/me", undefined],
      ["/invitations/preview", { token: invitationToken }],
      ["/admin/invitations", { email: "new@example.test", role: "user" }],
    ]) {
      const response = await identity(path, body, { authorization: "Bearer invalid" });
      assert.equal(response.status, 403, path);
    }
    await denied(() => call("/sign-up/email", signup, new Map()), "FORBIDDEN");
    await denied(() => service.requireData(request("/get-session")), "MFA_ENROLLMENT_REQUIRED");
    const setup = await (await call("/two-factor/enable", { password })).json();
    assert.equal(setup.backupCodes.length, 10);
    const secret = await database.transaction(async (tx) => {
      const { secretConfig } = await createAuth(tx, configuration).$context;
      const row = (
        await tx.execute(sql`SELECT secret FROM auth.two_factors WHERE user_id=${userId}::uuid`)
      ).rows[0];
      return symmetricDecrypt({ key: secretConfig, data: row.secret });
    });
    const previous = totpCode(secret, Math.floor(Date.now() / 30000) - 1);
    const oldCookie = cookies.get(SESSION_COOKIE);
    const verified = await (await call("/two-factor/verify-totp", { code: previous })).json();
    assert.ok(
      verified.session.mfaVerifiedAt,
      "Enrollment must mark the replacement session verified",
    );
    assert.notEqual(cookies.get(SESSION_COOKIE), oldCookie);
    assert.equal((await service.requireData(request("/get-session"))).user_id, userId);
    await denied(() => call("/two-factor/verify-totp", { code: previous }), "UNAUTHENTICATED");
    const current = totpCode(secret, Math.floor(Date.now() / 30000));
    const beforeStepUp = new Map(cookies);
    const upgraded = await service.stepUp(request("/step-up", {}), current);
    assert.equal(upgraded.status, 200);
    for (const cookie of upgraded.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    assert.equal(await service.principal(request("/get-session", undefined, beforeStepUp)), null);
    assert.equal((await identity("/analytics/synthetic-probe")).status, 404);
    // Renew both the database deadline and the browser cookie at most daily.
    await database.transaction((tx) =>
      tx.execute(
        // INSERT an aged fixture: UPDATE correctly overwrites updated_at via the DB trigger.
        sql`WITH old AS (DELETE FROM auth.sessions WHERE user_id=${userId}::uuid RETURNING *) INSERT INTO auth.sessions(id,user_id,token,created_at,updated_at,expires_at,mfa_verified_at,mfa_method) SELECT id,user_id,token,now()-interval '29 days',now()-interval '2 days',now()+interval '2 hours',mfa_verified_at,mfa_method FROM old`,
      ),
    );
    const renewed = await call("/get-session");
    const renewedCookie = renewed.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(renewedCookie);
    const maximumAge = Number(/Max-Age=(\d+)/u.exec(renewedCookie)[1]);
    assert.ok(
      maximumAge > 86000 && maximumAge <= 86400,
      "Renewal must respect the absolute 30-day deadline",
    );
    assert.equal(
      (await call("/get-session")).headers.getSetCookie().length,
      0,
      "No repeated renewal before 24 hours",
    );
    await database.transaction((tx) =>
      tx.execute(
        sql`UPDATE auth.sessions SET created_at=now(),updated_at=now(),expires_at=now()+interval '7 days' WHERE user_id=${userId}::uuid`,
      ),
    );
    await executeAdminCommand(administration, {
      command: "flag",
      key: "module.analytics",
      action: "on",
      role: "pro",
      reason: "Synthetic integration test",
    });
    assert.equal((await identity("/analytics/synthetic-probe")).status, 200);
    await executeAdminCommand(administration, {
      command: "flag",
      key: "module.analytics",
      action: "off",
      reason: "Synthetic integration test",
    });
    assert.equal((await identity("/analytics/synthetic-probe")).status, 404);
    for (const role of ["user", "pro"]) {
      await database.transaction((tx) =>
        tx.execute(sql`UPDATE auth.users SET role=${role} WHERE id=${userId}::uuid`),
      );
      const response = await identity("/admin/invitations", {
        email: "new@example.test",
        role: "user",
        sendEmail: false,
      });
      assert.equal(response.status, 403);
    }
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET role='admin' WHERE id=${userId}::uuid`),
    );
    const invitationKey = randomUUID();
    const invitationInput = {
      email: "new@example.test",
      role: "user",
      sendEmail: true,
    };
    const invitation = await identity("/admin/invitations", invitationInput, {
      "Idempotency-Key": invitationKey,
    });
    assert.equal(invitation.status, 201);
    const invitationBody = await invitation.json();
    assert.equal(new URL(invitationBody.inviteUrl).search, "");
    assert.equal(invitations.length, 1);
    const repeat = await identity("/admin/invitations", invitationInput, {
      "Idempotency-Key": invitationKey,
    });
    assert.equal(repeat.status, 201);
    assert.equal(repeat.headers.get("Idempotent-Replayed"), "true");
    assert.deepEqual(await repeat.json(), invitationBody);
    let releaseLock;
    let acquiredLock;
    const acquired = new Promise((resolve) => {
      acquiredLock = resolve;
    });
    const release = new Promise((resolve) => {
      releaseLock = resolve;
    });
    const held = database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      acquiredLock();
      await release;
    });
    await acquired;
    try {
      const busy = await identity("/admin/invitations", invitationInput, {
        "Idempotency-Key": invitationKey,
      });
      assert.equal(busy.status, 409);
      assert.equal(busy.headers.get("Retry-After"), "1");
      assert.equal((await busy.json()).code, "CONFLICT");
    } finally {
      releaseLock();
      await held;
    }
    assert.equal(invitations.length, 1, "Replay must not enqueue a second email");
    const conflict = await identity(
      "/admin/invitations",
      { ...invitationInput, role: "pro" },
      { "Idempotency-Key": invitationKey },
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "IDEMPOTENCY_CONFLICT");
    const persisted = await appDatabase.transaction(
      { userId, role: "admin" },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT response_body FROM platform.idempotency_keys WHERE key=${invitationKey}`,
          )
        ).rows[0],
    );
    assert.ok(!JSON.stringify(persisted).includes(invitations[0].token));
    assert.equal(
      await appDatabase.transaction(
        { userId: ownerId, role: "admin" },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT key FROM platform.idempotency_keys WHERE key=${invitationKey}`,
            )
          ).rows.length,
      ),
      0,
    );
    const separate = await database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(730101)`);
      return administration.createInvitation(
        { userId: ownerId, role: "admin" },
        tx,
        { email: "separate@example.test", role: "user", sendEmail: false },
        invitationKey,
      );
    });
    assert.notEqual(separate.value.id, invitationBody.id);
    await appDatabase.transaction({ userId, role: "admin" }, (tx) =>
      tx.execute(
        sql`UPDATE platform.idempotency_keys SET expires_at=now()-interval '1 second' WHERE key=${invitationKey}`,
      ),
    );
    const expiredReplay = await identity("/admin/invitations", invitationInput, {
      "Idempotency-Key": invitationKey,
    });
    assert.equal(expiredReplay.status, 409);
    assert.equal(expiredReplay.headers.get("Idempotent-Replayed"), null);
    const preview = await identity("/invitations/preview", { token: invitations[0].token });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).emailMasked, "n***@e***.test");
    assert.equal((await identity("/invitations/preview", { token: "x".repeat(43) })).status, 404);
    assert.equal(
      (await identity("/admin/invitations", { email: "new@example.test", role: "user" })).status,
      409,
    );
    const auditRows = await appDatabase.transaction(
      { userId, role: "admin" },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT outcome,actor_ref,resource_id,resource_type,request_id,ip,after FROM platform.audit_log WHERE action='admin.invitation.create'`,
          )
        ).rows,
    );
    assert.ok(auditRows.some((row) => row.outcome === "denied"));
    assert.ok(auditRows.some((row) => row.outcome === "success"));
    assert.ok(auditRows.every((row) => /^[a-f0-9]{64}$/u.test(row.actor_ref)));
    const createdAudit = auditRows.find((row) => row.outcome === "success");
    assert.equal(createdAudit.resource_id, invitationBody.id);
    assert.equal(createdAudit.resource_type, "invitation");
    assert.equal(createdAudit.after.email, "new@example.test");
    assert.equal(createdAudit.ip, "192.0.2.1");
    assert.ok(createdAudit.request_id);
    assert.ok(!JSON.stringify(auditRows).includes(invitations[0].token));
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET role='pro' WHERE id=${userId}::uuid`),
    );
    const extraToken = randomBytes(32).toString("hex");
    const extraId = await database.transaction(
      async (tx) =>
        (
          await tx.execute(
            sql`INSERT INTO auth.sessions (user_id,token,expires_at,ip_address) VALUES (${userId}::uuid,${extraToken},now()+interval '1 hour','192.0.2.19') RETURNING id`,
          )
        ).rows[0].id,
    );
    const sessions = await (await call("/list-sessions")).json();
    assert.equal(sessions.length, 2);
    assert.equal(sessions.find((row) => row.id === extraId).ipAddress, "192.0.2.0/24");
    assert.equal(sessions.find((row) => row.id === extraId).current, false);
    assert.equal(sessions.filter((row) => row.current).length, 1);
    assert.equal(
      sessions.find((row) => row.current).id,
      (await service.principal(request("/get-session"))).id,
    );
    assert.ok(sessions.every((row) => !Object.hasOwn(row, "token")));
    const storedTokens = await database.transaction(
      async (tx) => (await tx.execute(sql`SELECT token FROM auth.sessions`)).rows,
    );
    for (const { token } of storedTokens) assert.ok(!JSON.stringify(sessions).includes(token));
    const foreignId = await database.transaction(
      async (tx) =>
        (await tx.execute(sql`SELECT id FROM auth.sessions WHERE user_id=${ownerId}::uuid`)).rows[0]
          .id,
    );
    await denied(() => call("/revoke-session", { token: extraToken }), "BAD_REQUEST");
    await denied(() => call("/revoke-session", { id: foreignId }), "FORBIDDEN");
    await denied(() => call("/revoke-session", { id: randomUUID() }), "FORBIDDEN");
    await call("/revoke-session", { id: extraId });
    assert.equal((await (await call("/list-sessions")).json()).length, 1);
    assert.equal(
      await database.transaction(
        async (tx) =>
          (await tx.execute(sql`SELECT id FROM auth.sessions WHERE id=${foreignId}::uuid`)).rows
            .length,
      ),
      1,
    );
    for (const [createdDays, expiryHours] of [
      [31, 1],
      [1, -1],
    ]) {
      const expiredToken = randomBytes(32).toString("hex");
      await database.transaction((tx) =>
        tx.execute(
          sql`INSERT INTO auth.sessions(user_id,token,created_at,expires_at) VALUES (${userId}::uuid,${expiredToken},now()-${createdDays}*interval '1 day',now()+${expiryHours}*interval '1 hour')`,
        ),
      );
      const signed = sessionCookie(expiredToken, configuration, true)
        .split(";")[0]
        .slice(SESSION_COOKIE.length + 1);
      assert.equal(
        await service.principal(
          request("/get-session", undefined, new Map([[SESSION_COOKIE, signed]])),
        ),
        null,
      );
    }
    await denied(() => service.stepUp(request("/step-up", {}), current), "UNAUTHENTICATED");
    await database.transaction((tx) =>
      tx.execute(
        sql`UPDATE auth.sessions SET mfa_verified_at=now()-interval '16 minutes' WHERE user_id=${userId}::uuid`,
      ),
    );
    await denied(() => call("/revoke-other-sessions", {}), "STEP_UP_REQUIRED");
    const logout = await call("/sign-out", {});
    assert.equal(logout.headers.get("Clear-Site-Data"), '"cache", "cookies", "storage"');
    assert.equal(await service.principal(request("/get-session")), null);
    const login = await (await call("/sign-in/email", { email, password })).json();
    assert.deepEqual(login, { twoFactorRedirect: true });
    assert.equal(await service.principal(request("/get-session")), null);
    const challenge = new Map(cookies);
    const results = await Promise.allSettled([
      call("/two-factor/verify-backup-code", { code: setup.backupCodes[0] }),
      call("/two-factor/verify-backup-code", { code: setup.backupCodes[0] }, challenge),
    ]);
    assert.equal(
      results.filter((r) => r.status === "fulfilled").length,
      1,
      "Backup is consumed once across concurrent requests",
    );
    if (results[1].status === "fulfilled") {
      cookies.clear();
      for (const [key, value] of challenge) cookies.set(key, value);
    }
    assert.equal((await service.principal(request("/get-session"))).mfa_method, "backup");
    await denied(
      () =>
        call("/change-password", {
          currentPassword: password,
          newPassword: randomBytes(24).toString("hex"),
        }),
      "STEP_UP_REQUIRED",
    );
    await denied(() => call("/two-factor/generate-backup-codes", { password }), "STEP_UP_REQUIRED");
    for (const path of ["/api/v1/me/export", "/api/v1/me/tokens"])
      await denied(
        () =>
          service.requireData(
            new Request(`${configuration.origin}${path}`, {
              headers: { cookie: request("/get-session").headers.get("cookie") },
            }),
            true,
          ),
        "STEP_UP_REQUIRED",
      );
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.users SET role='admin' WHERE id=${userId}::uuid`),
    );
    await denied(
      () => service.requireAdmin(request("/get-session"), "admin:users"),
      "STEP_UP_REQUIRED",
    );
    await denied(
      () => service.requireAdmin(request("/get-session"), "admin:users", true),
      "STEP_UP_REQUIRED",
    );
    assert.equal(
      (await identity("/admin/invitations", { email: "backup-denied@example.test", role: "user" }))
        .status,
      403,
    );
    await database.transaction((tx) =>
      tx.execute(
        sql`UPDATE auth.sessions SET mfa_verified_at=now()-interval '10 minutes' WHERE user_id=${userId}::uuid`,
      ),
    );
    await denied(() => call("/two-factor/enable", { password }), "STEP_UP_REQUIRED");
    await database.transaction((tx) =>
      tx.execute(sql`UPDATE auth.sessions SET mfa_verified_at=now() WHERE user_id=${userId}::uuid`),
    );
    await denied(
      () => call("/two-factor/enable", { password: "wrong password" }),
      "UNAUTHENTICATED",
    );
    const recovering = await (await call("/two-factor/enable", { password })).json();
    await denied(() => call("/two-factor/enable", { password }), "STEP_UP_REQUIRED");
    await denied(() => service.requireData(request("/get-session")), "MFA_REQUIRED");
    const freshLogin = new Map();
    assert.deepEqual(await (await call("/sign-in/email", { email, password }, freshLogin)).json(), {
      twoFactorRedirect: true,
    });
    await denied(() => call("/two-factor/enable", { password }, freshLogin), "UNAUTHENTICATED");
    const newSecret = await database.transaction(async (tx) => {
      const { secretConfig } = await createAuth(tx, configuration).$context;
      const row = (
        await tx.execute(sql`SELECT secret FROM auth.two_factors WHERE user_id=${userId}::uuid`)
      ).rows[0];
      return symmetricDecrypt({ key: secretConfig, data: row.secret });
    });
    assert.notEqual(newSecret, secret);
    // Replay state is per user, including replacement of the secret. A new clock
    // step is required when the old TOTP was used earlier in the same 30s window.
    const wait = Math.max(0, ((steps.get(userId) ?? 0) + 1) * 30000 - Date.now() + 50);
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    await database.transaction((tx) =>
      tx.execute(sql`INSERT INTO auth.sessions(user_id,token,expires_at)
      VALUES (${userId}::uuid,${randomBytes(24).toString("hex")},now()+interval '1 day')`),
    );
    const completed = await (
      await call("/two-factor/verify-totp", {
        code: totpCode(newSecret, Math.floor(Date.now() / 30000)),
      })
    ).json();
    assert.equal(completed.backupCodes.length, 10);
    assert.ok(
      completed.backupCodes.every(
        (code) => !setup.backupCodes.includes(code) && !recovering.backupCodes.includes(code),
      ),
    );
    assert.equal((await service.principal(request("/get-session"))).mfa_method, "totp");
    assert.equal(
      (
        await database.transaction((tx) =>
          tx.execute(sql`SELECT id FROM auth.sessions WHERE user_id=${userId}::uuid`),
        )
      ).rows.length,
      1,
    );
    assert.deepEqual(
      securityEvents.map((event) => event.kind),
      ["two_factor_recovery_started", "two_factor_recovered"],
    );
    const audits = (
      await appDatabase.transaction({ userId, role: "admin" }, (tx) =>
        tx.execute(
          sql`SELECT action,outcome FROM platform.audit_log WHERE actor_user_id=${userId}::uuid AND action LIKE 'auth.two_factor.recovery.%'`,
        ),
      )
    ).rows;
    assert.deepEqual(audits.map((row) => row.action).sort(), [
      "auth.two_factor.recovery.completed",
      "auth.two_factor.recovery.started",
    ]);
    await denied(
      () => call("/two-factor/verify-backup-code", { code: setup.backupCodes[1] }),
      "UNAUTHENTICATED",
    );
    // Clear this deliberately recorded failure so the next assertion starts at 0.
    await database.transaction((tx) =>
      tx.execute(
        sql`UPDATE auth.two_factors SET failed_verification_count=0 WHERE user_id=${userId}::uuid`,
      ),
    );
    // Account lock applies also to active-session verification, not only sign-in.
    for (let i = 0; i < 5; i++)
      await denied(() => call("/two-factor/verify-totp", { code: "000000" }), "UNAUTHENTICATED");
    await denied(
      () => call("/two-factor/verify-backup-code", { code: setup.backupCodes[1] }),
      "RATE_LIMITED",
    );
    await denied(() => service.stepUp(request("/step-up", {}), current), "RATE_LIMITED");
    await call("/request-password-reset", { email }, new Map());
    assert.equal(mail.length, 1);
    const replacement = randomBytes(24).toString("hex");
    await call("/reset-password", { token: mail[0].token, newPassword: replacement }, new Map());
    assert.equal(await service.principal(request("/get-session")), null);
    await denied(
      () => call("/reset-password", { token: mail[0].token, newPassword: replacement }, new Map()),
      "BAD_REQUEST",
    );
    await call("/request-password-reset", { email: "missing@example.test" }, new Map());
    assert.equal(mail.length, 1);
    for (const path of [
      "/two-factor/disable",
      "/admin/create-user",
      "/admin/impersonate-user",
      "/sign-in/social",
      "/two-factor/send-otp",
      "/api-key/create",
    ])
      await denied(() => call(path, {}), "FORBIDDEN");
    await denied(
      () =>
        service.handle(
          new Request(`${configuration.origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { origin: "https://evil.example", "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          }),
          "192.0.2.1",
        ),
      "FORBIDDEN",
    );
    const cli = (input) =>
      executeAdminCommand(administration, { reason: "Synthetic integration test", ...input });
    await denied(() => cli({ command: "unknown" }), "VALIDATION_FAILED");
    await denied(
      () => cli({ command: "revoke-all-sessions", password: "not-allowed" }),
      "VALIDATION_FAILED",
    );
    const cliInvite = await cli({ command: "invite", email: "cli@example.test", role: "pro" });
    assert.match(new URL(cliInvite.inviteUrl).hash, /^#t=/u);
    await cli({ command: "flag", key: "module.analytics", action: "on", role: "pro" });
    assert.equal(await service.features.enabled("module.analytics", { userId, role: "pro" }), true);
    assert.equal(
      await service.features.enabled("module.analytics", { userId, role: "user" }),
      false,
    );
    await cli({ command: "flag", key: "module.analytics", action: "off" });
    assert.equal(
      await service.features.enabled("module.analytics", { userId, role: "pro" }),
      false,
    );
    await denied(
      () => cli({ command: "flag", key: "module.identity", action: "off" }),
      "FORBIDDEN",
    );
    await cli({ command: "queues", action: "pause", queue: "notify" });
    await cli({ command: "queues", action: "resume", queue: "notify" });
    assert.deepEqual(queueActions, [
      ["pause", "notify"],
      ["resume", "notify"],
    ]);
    await database.transaction((tx) =>
      tx.execute(
        sql`INSERT INTO auth.api_keys(reference_id,key) VALUES (${userId}::uuid,${randomBytes(32).toString("hex")}),(${ownerId}::uuid,${randomBytes(32).toString("hex")})`,
      ),
    );
    await cli({ command: "revoke-pats", email });
    assert.equal(
      (
        await database.transaction((tx) =>
          tx.execute(sql`SELECT enabled FROM auth.api_keys WHERE reference_id=${userId}::uuid`),
        )
      ).rows[0].enabled,
      false,
    );
    await cli({ command: "revoke-all-pats" });
    assert.ok(
      (
        await database.transaction((tx) => tx.execute(sql`SELECT enabled FROM auth.api_keys`))
      ).rows.every((row) => !row.enabled),
    );
    await database.transaction((tx) =>
      tx.execute(
        sql`INSERT INTO auth.sessions(user_id,token,expires_at) VALUES (${userId}::uuid,${randomBytes(32).toString("hex")},now()+interval '1 hour')`,
      ),
    );
    await cli({ command: "revoke-sessions", email });
    assert.equal(
      (
        await database.transaction((tx) =>
          tx.execute(sql`SELECT id FROM auth.sessions WHERE user_id=${userId}::uuid`),
        )
      ).rows.length,
      0,
    );
    await cli({ command: "revoke-all-sessions" });
    await cli({ command: "reset-2fa", email });
    assert.equal(resets.length, 1);
    assert.equal(
      (
        await database.transaction((tx) =>
          tx.execute(sql`SELECT two_factor_enabled FROM auth.users WHERE id=${userId}::uuid`),
        )
      ).rows[0].two_factor_enabled,
      false,
    );
    assert.equal(
      (
        await database.transaction((tx) =>
          tx.execute(sql`SELECT id FROM auth.two_factors WHERE user_id=${userId}::uuid`),
        )
      ).rows.length,
      0,
    );
    const cliAudit = (
      await appDatabase.transaction({ userId: ownerId, role: "admin" }, (tx) =>
        tx.execute(
          sql`SELECT action,actor_type,after FROM platform.audit_log WHERE action LIKE 'cli.%'`,
        ),
      )
    ).rows;
    for (const command of [
      "invite",
      "flag",
      "queues",
      "revoke-pats",
      "revoke-all-pats",
      "revoke-sessions",
      "revoke-all-sessions",
      "reset-2fa",
    ])
      assert.ok(
        cliAudit.some(
          (row) =>
            row.action === `cli.${command}` &&
            row.actor_type === "system" &&
            row.after.reason === "Synthetic integration test",
        ),
        command,
      );
    assert.deepEqual(events, []);
  } finally {
    if (ownerId)
      await appDatabase.transaction({ userId: ownerId, role: "admin" }, (tx) =>
        tx.execute(
          sql`DELETE FROM identity.invitations WHERE invited_by=${ownerId}::uuid OR invited_by=${userId ?? ownerId}::uuid`,
        ),
      );
    for (const id of [userId, ownerId].filter(Boolean))
      await database.transaction((tx) =>
        tx.execute(sql`DELETE FROM auth.users WHERE id=${id}::uuid`),
      );
    await Promise.all([database.close(), appDatabase.close()]);
  }
}
