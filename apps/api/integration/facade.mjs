import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { symmetricDecrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { AuditWriter } from "../dist/auth/audit.js";
import { createAuth } from "../dist/auth/config.js";
import { AuthService } from "../dist/auth/service.js";
import { SESSION_COOKIE } from "../dist/auth/session.js";
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
    const response = await service.handle(request(path, body, jar), "192.0.2.1");
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
  const password = randomBytes(24).toString("hex");
  const email = `${randomUUID()}@example.test`;
  const invitationToken = randomBytes(32).toString("base64url");
  let ownerId;
  let userId;
  try {
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
    assert.deepEqual(events, []);
  } finally {
    if (ownerId)
      await appDatabase.transaction({ userId: ownerId, role: "admin" }, (tx) =>
        tx.execute(sql`DELETE FROM identity.invitations WHERE invited_by=${ownerId}::uuid`),
      );
    for (const id of [userId, ownerId].filter(Boolean))
      await database.transaction((tx) =>
        tx.execute(sql`DELETE FROM auth.users WHERE id=${id}::uuid`),
      );
    await Promise.all([database.close(), appDatabase.close()]);
  }
}
