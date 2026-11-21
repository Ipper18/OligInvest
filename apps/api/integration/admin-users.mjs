import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { sessionCookie } from "../dist/auth/session.js";

// BL-112, BL-501, BL-509 (FR-08.01, FR-08.02): administrator shell API against PostgreSQL.
// Synthetic accounts only (example.invalid, RFC 5737 addresses).
const DOMAIN_SCHEMAS = /\b(portfolio|analytics|alerts|market|education|notifications)\.[a-z_]+/giu;
const USER_KEYS = new Set([
  "id",
  "email",
  "name",
  "role",
  "banned",
  "banReason",
  "banExpires",
  "twoFactorEnabled",
  "emailVerified",
  "createdAt",
  "lastActiveAt",
  "activeSessions",
  "deletionScheduledFor",
  "deletionRequestedBy",
]);

export async function testAdminUsers({
  app,
  administration,
  database,
  appDatabase,
  cookies,
  userId,
  emailChanges,
  resets,
}) {
  const service = administration.service;
  const { configuration } = service.options;
  const admin = { userId, role: "admin" };
  const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const call = async (method, path, body, headers = {}) => {
    const requestId = randomUUID();
    const response = await app.request(`/api/v1${path}`, {
      method,
      headers: {
        origin: configuration.origin,
        "content-type": "application/json",
        cookie: cookieHeader(),
        "x-request-id": requestId,
        "user-agent": "Synthetic admin shell test",
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      response,
      status: response.status,
      text,
      data: text ? JSON.parse(text) : null,
      requestId,
    };
  };
  const audit = (requestId) =>
    appDatabase.transaction(
      admin,
      async (tx) =>
        (
          await tx.execute(sql`SELECT action,outcome,resource_type,resource_id,before,after
            FROM platform.audit_log WHERE request_id=${requestId} ORDER BY occurred_at,id`)
        ).rows,
    );
  const expect = async (result, status, code) => {
    assert.equal(result.status, status, `${status} expected: ${result.text}`);
    if (code) assert.equal(result.data.code, code);
    const rows = await audit(result.requestId);
    const outcome = rows.filter((row) => !row.action.endsWith(".started"));
    assert.equal(outcome.length, 1, `One outcome audit row: ${JSON.stringify(rows)}`);
    assert.equal(outcome[0].outcome, status < 400 ? "success" : "denied");
    return { ...result, audit: outcome[0], rows };
  };
  const auth = (statement) => database.transaction((tx) => tx.execute(statement));

  // ── Synthetic accounts: a target with portfolio data and an e-mail collision candidate.
  const ids = { alice: randomUUID(), bob: randomUUID() };
  const email = (name, id = ids[name]) => `${name}-${id}@example.invalid`;
  const marker = `FINANCIAL-${randomBytes(6).toString("hex")}`;
  const tokens = { alice: randomBytes(32).toString("hex"), other: randomBytes(32).toString("hex") };
  await database.transaction(async (tx) => {
    for (const [name, id] of Object.entries(ids))
      await tx.execute(sql`INSERT INTO auth.users(id,name,email,email_verified,two_factor_enabled)
        VALUES(${id}::uuid,${`Synthetic ${name}`},${email(name)},true,true)`);
    for (const token of Object.values(tokens))
      await tx.execute(sql`INSERT INTO auth.sessions(token,user_id,expires_at,ip_address,user_agent,mfa_verified_at,mfa_method)
        VALUES(${token},${ids.alice}::uuid,now()+interval '1 day','192.0.2.7','Synthetic agent',now(),'totp')`);
  });
  await service.recordConsents(ids.alice, false);
  await appDatabase.transaction({ userId: ids.alice, role: "user" }, (tx) =>
    tx.execute(sql`INSERT INTO portfolio.accounts(user_id,name,broker,currency)
      VALUES(${ids.alice}::uuid,${marker},'demo','PLN')`),
  );
  const aliceCookie = sessionCookie(tokens.alice, configuration, true).split(";")[0];

  // Fresh TOTP step-up for the administrator; restored at the end.
  const session = (
    await auth(
      sql`SELECT mfa_verified_at,mfa_method FROM auth.sessions WHERE user_id=${userId}::uuid`,
    )
  ).rows[0];
  const setStepUp = (at) =>
    auth(
      sql`UPDATE auth.sessions SET mfa_verified_at=${at},mfa_method='totp' WHERE user_id=${userId}::uuid`,
    );
  await setStepUp(new Date());

  const calls = [];
  const original = service.options.securityMonitor;
  // Records every monitor call; security-events.mjs proves the delivery to all administrators.
  service.options.securityMonitor = new Proxy(
    {},
    {
      get: (_target, name) => async (actor, event) => {
        if (name === "administrativeChanged") calls.push(["changed", actor.userId, event]);
        else if (name === "deletionRequestedByAdmin")
          calls.push(["deletion-admin", actor.userId, event.scheduledFor]);
        else if (name === "deletionCancelled") calls.push(["deletion-cancelled", actor.userId]);
        else calls.push([String(name), actor.userId]);
      },
    },
  );
  try {
    // ── Gates: session, PAT, origin, role, step-up (changes only).
    await expect(
      await call("GET", "/admin/users", undefined, { cookie: "" }),
      401,
      "UNAUTHENTICATED",
    );
    await expect(
      await call("GET", "/admin/users", undefined, { authorization: "Bearer synthetic-pat" }),
      403,
      "FORBIDDEN",
    );
    await expect(
      await call(
        "PATCH",
        `/admin/users/${ids.alice}`,
        { role: "pro" },
        { origin: "https://other.example.test" },
      ),
      403,
      "FORBIDDEN",
    );
    for (const role of ["user", "pro"]) {
      await auth(sql`UPDATE auth.users SET role=${role} WHERE id=${userId}::uuid`);
      try {
        await expect(await call("GET", "/admin/users"), 403, "FORBIDDEN");
        await expect(await call("GET", `/admin/users/${ids.alice}`), 403, "FORBIDDEN");
        // A non-administrator never gets a step-up prompt, even with a stale step-up.
        await setStepUp(new Date(Date.now() - 16 * 60_000));
        await expect(
          await call("PATCH", `/admin/users/${ids.alice}`, { role: "pro" }),
          403,
          "FORBIDDEN",
        );
        await setStepUp(new Date());
      } finally {
        await auth(sql`UPDATE auth.users SET role='admin' WHERE id=${userId}::uuid`);
      }
    }
    await setStepUp(new Date(Date.now() - 16 * 60_000));
    await expect(await call("GET", `/admin/users/${ids.alice}`), 200);
    for (const [method, path, body] of [
      ["PATCH", `/admin/users/${ids.alice}`, { role: "pro" }],
      ["DELETE", `/admin/users/${ids.alice}`],
      ["DELETE", `/admin/users/${ids.alice}/deletion-request`],
      ["POST", `/admin/users/${ids.alice}/reset-2fa`, { reason: "Synthetic reason" }],
      ["POST", `/admin/users/${ids.alice}/revoke-sessions`],
      ["DELETE", `/admin/invitations/${randomUUID()}`],
      ["DELETE", `/admin/sessions/${randomUUID()}`],
    ])
      await expect(await call(method, path, body), 403, "STEP_UP_REQUIRED");
    await setStepUp(new Date());

    // ── No financial data: statements of every read stay out of domain schemas.
    const statements = [];
    const dialect = new PgDialect();
    const wrap = (tx) =>
      new Proxy(tx, {
        get(target, key, receiver) {
          if (key !== "execute") return Reflect.get(target, key, receiver);
          return (query) => {
            statements.push(typeof query === "string" ? query : dialect.sqlToQuery(query).sql);
            return target.execute(query);
          };
        },
      });
    const databases = {
      database: service.options.database,
      appDatabase: service.options.appDatabase,
    };
    service.options.database = {
      ...databases.database,
      transaction: (work) => databases.database.transaction((tx) => work(wrap(tx))),
    };
    service.options.appDatabase = {
      ...databases.appDatabase,
      transaction: (context, work) =>
        databases.appDatabase.transaction(context, (tx) => work(wrap(tx))),
    };
    let reads;
    try {
      reads = [
        await expect(
          await call("GET", `/admin/users?q=${encodeURIComponent("alice-")}&limit=200`),
          200,
        ),
        await expect(await call("GET", `/admin/users/${ids.alice}`), 200),
        await expect(await call("GET", `/admin/sessions?userId=${ids.alice}`), 200),
        await expect(await call("GET", "/admin/invitations"), 200),
      ];
    } finally {
      Object.assign(service.options, databases);
    }
    assert.ok(statements.length > 0, "Statements were captured");
    assert.deepEqual(
      statements.flatMap((text) => text.match(DOMAIN_SCHEMAS) ?? []),
      [],
      "Admin reads never name a domain (financial) schema",
    );
    for (const read of reads)
      assert.ok(!read.text.includes(marker), "No portfolio value in a response");
    const listed = reads[0].data.data.find((user) => user.id === ids.alice);
    assert.ok(listed, "Search finds the account");
    for (const key of Object.keys(listed)) assert.ok(USER_KEYS.has(key), `Unexpected field ${key}`);
    assert.equal(reads[1].data.activeSessions, 2);
    assert.equal(reads[1].data.twoFactorEnabled, true);
    assert.deepEqual(new Set(reads[2].data.data.map((row) => row.userId)), new Set([ids.alice]));
    assert.equal(reads[2].data.data[0].ipAddress, "192.0.2.7");
    // Auth role: no grant on portfolio at all (defence below RLS).
    await assert.rejects(
      () => auth(sql`SELECT 1 FROM portfolio.accounts LIMIT 1`),
      (error) => (error.cause ?? error).code === "42501",
    );
    // App role in the admin context: RLS hides every portfolio row.
    const visible = await appDatabase.transaction(admin, async (tx) =>
      Number(
        (await tx.execute(sql`SELECT count(*)::int AS count FROM portfolio.accounts`)).rows[0]
          .count,
      ),
    );
    assert.equal(visible, 0, "Admin context sees no portfolio rows");
    // Keyset paging and malformed cursors.
    const first = await expect(await call("GET", "/admin/users?limit=1"), 200);
    assert.equal(first.data.data.length, 1);
    if (first.data.page.hasMore) {
      const second = await expect(
        await call("GET", `/admin/users?limit=1&cursor=${first.data.page.nextCursor}`),
        200,
      );
      assert.notEqual(second.data.data[0].id, first.data.data[0].id);
    }
    await expect(await call("GET", "/admin/users?cursor=not-a-cursor!"), 422, "VALIDATION_FAILED");
    await expect(await call("GET", "/admin/users?role=root"), 422, "VALIDATION_FAILED");
    await expect(await call("GET", "/admin/users/not-a-uuid"), 422, "VALIDATION_FAILED");
    await expect(await call("GET", `/admin/users/${randomUUID()}`), 404, "NOT_FOUND");

    // ── Self-protection.
    const self = `/admin/users/${userId}`;
    await expect(
      await call("PATCH", self, { email: email("self", randomUUID()) }),
      409,
      "CONFLICT",
    );
    await expect(
      await call("PATCH", self, { banned: true, banReason: "Synthetic self block" }),
      409,
      "CONFLICT",
    );
    await expect(await call("DELETE", self), 409, "CONFLICT");
    await expect(
      await call("POST", `${self}/reset-2fa`, { reason: "Synthetic self reset" }),
      409,
      "CONFLICT",
    );
    const otherAdmins = Number(
      (
        await auth(sql`SELECT count(*)::int AS count FROM auth.users WHERE role='admin' AND id<>${userId}::uuid
          AND (NOT banned OR (ban_expires IS NOT NULL AND ban_expires<=now()))`)
      ).rows[0].count,
    );
    if (otherAdmins === 0)
      await expect(await call("PATCH", self, { role: "user" }), 409, "CONFLICT");

    // ── Validation of the patch.
    for (const body of [
      {},
      { role: "root" },
      { banned: true },
      { banned: true, banReason: "abc" },
      { banReason: "Synthetic reason only" },
      { banned: true, banReason: "Synthetic past", banExpires: "2000-01-01T00:00:00Z" },
      { email: "not-an-email" },
      { role: "pro", extra: true },
      "{",
    ])
      await expect(
        await call("PATCH", `/admin/users/${ids.alice}`, body),
        422,
        "VALIDATION_FAILED",
      );

    // ── Admin-requested deletion (BL-509): 14 days, only an administrator cancels it.
    const deletion = await expect(await call("DELETE", `/admin/users/${ids.alice}`), 202);
    assert.equal(deletion.data.requestedBy, "admin");
    const graceDays =
      (Date.parse(deletion.data.scheduledFor) - Date.parse(deletion.data.requestedAt)) / 86400_000;
    assert.ok(graceDays >= 13.99 && graceDays <= 14.01, `14-day grace: ${graceDays}`);
    assert.deepEqual(deletion.audit.after, {
      scheduledFor: deletion.data.scheduledFor,
      requestedBy: "admin",
    });
    assert.deepEqual(calls.at(-1), ["deletion-admin", ids.alice, deletion.data.scheduledFor]);
    await expect(await call("DELETE", `/admin/users/${ids.alice}`), 409, "CONFLICT");
    const detail = await expect(await call("GET", `/admin/users/${ids.alice}`), 200);
    assert.equal(detail.data.deletionRequestedBy, "admin");
    assert.equal(detail.data.deletionScheduledFor, deletion.data.scheduledFor);
    const asAlice = (method) =>
      app.request("/api/v1/me/deletion-request", {
        method,
        headers: { cookie: aliceCookie, origin: configuration.origin },
      });
    const own = await asAlice("GET");
    assert.equal(own.status, 200);
    assert.equal((await own.json()).requestedBy, "admin");
    assert.equal((await asAlice("DELETE")).status, 409, "The user cannot cancel an admin request");
    assert.equal((await asAlice("POST")).status, 409, "No second request while one is active");
    await expect(await call("DELETE", `/admin/users/${ids.alice}/deletion-request`), 204);
    assert.deepEqual(calls.at(-1), ["deletion-cancelled", ids.alice]);
    await expect(
      await call("DELETE", `/admin/users/${ids.alice}/deletion-request`),
      404,
      "NOT_FOUND",
    );
    // A request the user made stays the user's: the admin cancel path does not touch it.
    assert.equal((await asAlice("POST")).status, 202);
    await expect(
      await call("DELETE", `/admin/users/${ids.alice}/deletion-request`),
      404,
      "NOT_FOUND",
    );
    await expect(await call("DELETE", `/admin/users/${ids.alice}`), 409, "CONFLICT");
    assert.equal((await asAlice("DELETE")).status, 204);

    // ── Sessions (BL-501).
    const sessions = await expect(await call("GET", `/admin/sessions?userId=${ids.alice}`), 200);
    const target = sessions.data.data.find((row) => row.userId === ids.alice);
    const revokeOne = await expect(await call("DELETE", `/admin/sessions/${target.id}`), 204);
    assert.deepEqual(revokeOne.audit.after, { users: [ids.alice] });
    await expect(await call("DELETE", `/admin/sessions/${target.id}`), 404, "NOT_FOUND");
    const revokeAll = await expect(
      await call("POST", `/admin/users/${ids.alice}/revoke-sessions`),
      204,
    );
    assert.deepEqual(revokeAll.audit.after, { count: 1 });
    assert.equal((await call("GET", `/admin/users/${ids.alice}`)).data.activeSessions, 0);
    await expect(
      await call("POST", `/admin/users/${randomUUID()}/revoke-sessions`),
      404,
      "NOT_FOUND",
    );
    const reissue = (token = randomBytes(32).toString("hex")) =>
      auth(sql`INSERT INTO auth.sessions(token,user_id,expires_at,mfa_verified_at,mfa_method)
        VALUES(${token},${ids.alice}::uuid,now()+interval '1 day',now(),'totp')`);

    // ── Role change: sessions end, administrators are alerted.
    await reissue();
    const role = await expect(
      await call("PATCH", `/admin/users/${ids.alice}`, { role: "pro" }),
      200,
    );
    assert.equal(role.data.role, "pro");
    assert.equal(role.data.activeSessions, 0);
    assert.deepEqual(role.audit.before, { role: "user", banned: false, banExpires: null });
    assert.deepEqual(role.audit.after, { role: "pro", banned: false, banExpires: null, count: 1 });
    assert.deepEqual(calls.at(-1), ["changed", userId, "role"]);
    await expect(await call("PATCH", `/admin/users/${ids.alice}`, { role: "user" }), 200);

    // ── E-mail change (owner decision 2026-11-21).
    await reissue();
    await expect(
      await call("PATCH", `/admin/users/${ids.alice}`, { email: email("bob").toUpperCase() }),
      409,
      "CONFLICT",
    );
    const newEmail = email("alice-new");
    const mailsBefore = emailChanges.length;
    const changed = await expect(
      await call("PATCH", `/admin/users/${ids.alice}`, { email: newEmail }),
      200,
    );
    assert.equal(changed.data.email, newEmail);
    assert.equal(changed.data.activeSessions, 0);
    assert.ok(!JSON.stringify(changed.rows).includes("@"), "No address in the audit trail");
    assert.deepEqual(calls.at(-1), ["changed", userId, "email"]);
    const mails = emailChanges.slice(mailsBefore);
    assert.deepEqual(
      mails.map((mail) => [mail.audience, mail.email, mail.userId]),
      [
        ["previous", email("alice"), ids.alice],
        ["current", newEmail, ids.alice],
      ],
    );
    for (const mail of mails) {
      assert.match(mail.otherEmailMasked, /^[a-z0-9]\*\*\*@e\*\*\*\.invalid$/u);
      assert.ok(!mail.otherEmailMasked.includes(ids.alice));
    }

    // ── Block and unblock.
    await reissue();
    const banned = await expect(
      await call("PATCH", `/admin/users/${ids.alice}`, {
        banned: true,
        banReason: "Synthetic block reason",
        banExpires: new Date(Date.now() + 86400_000).toISOString(),
      }),
      200,
    );
    assert.equal(banned.data.banned, true);
    assert.equal(banned.data.banReason, "Synthetic block reason");
    assert.equal(banned.data.activeSessions, 0);
    assert.equal(banned.audit.after.reason, "Synthetic block reason");
    await reissue(tokens.alice);
    assert.equal(
      (await app.request("/api/v1/me", { headers: { cookie: aliceCookie } })).status,
      401,
      "A blocked account has no session",
    );
    const unbanned = await expect(
      await call("PATCH", `/admin/users/${ids.alice}`, { banned: false }),
      200,
    );
    assert.equal(unbanned.data.banned, false);
    assert.equal(unbanned.data.banReason, undefined);
    assert.equal(unbanned.data.activeSessions, 1, "Lifting a block keeps sessions");

    // ── 2FA reset.
    await expect(
      await call("POST", `/admin/users/${ids.alice}/reset-2fa`, { reason: "abc" }),
      422,
      "VALIDATION_FAILED",
    );
    const resetsBefore = resets.length;
    const reset = await expect(
      await call("POST", `/admin/users/${ids.alice}/reset-2fa`, {
        reason: "Synthetic identity verified",
      }),
      204,
    );
    assert.deepEqual(reset.audit.after, {
      twoFactorEnabled: false,
      reason: "Synthetic identity verified",
    });
    assert.deepEqual(calls.at(-1), ["changed", userId, "reset-2fa"]);
    assert.deepEqual(
      resets.slice(resetsBefore).map((mail) => mail.email),
      [newEmail],
    );
    const afterReset = await call("GET", `/admin/users/${ids.alice}`);
    assert.equal(afterReset.data.twoFactorEnabled, false);
    assert.equal(afterReset.data.activeSessions, 0);

    // ── Invitations.
    const invitation = randomUUID();
    await appDatabase.transaction(admin, (tx) =>
      tx.execute(sql`INSERT INTO identity.invitations(id,email,role,token_hash,invited_by,expires_at)
        VALUES(${invitation}::uuid,${email("invited", invitation)},'user',
          ${createHash("sha256").update(randomBytes(32)).digest("hex")},${userId}::uuid,now()+interval '72 hours')`),
    );
    const pending = await expect(
      await call("GET", "/admin/invitations?status=pending&limit=200"),
      200,
    );
    const row = pending.data.data.find((item) => item.id === invitation);
    assert.equal(row?.status, "pending");
    assert.equal(row.invitedBy, userId);
    assert.ok(!("tokenHash" in row) && !pending.text.includes("token"));
    await expect(await call("DELETE", `/admin/invitations/${invitation}`), 204);
    await expect(await call("DELETE", `/admin/invitations/${invitation}`), 409, "CONFLICT");
    await expect(await call("DELETE", `/admin/invitations/${randomUUID()}`), 404, "NOT_FOUND");
    const revoked = await expect(
      await call("GET", "/admin/invitations?status=revoked&limit=200"),
      200,
    );
    assert.ok(revoked.data.data.some((item) => item.id === invitation && item.revokedAt));
    await expect(await call("GET", "/admin/invitations?status=lost"), 422, "VALIDATION_FAILED");
  } finally {
    service.options.securityMonitor = original;
    await auth(
      sql`UPDATE auth.sessions SET mfa_verified_at=${session.mfa_verified_at},mfa_method=${session.mfa_method} WHERE user_id=${userId}::uuid`,
    );
    // Synthetic accounts leave no trace for later checks (the 10-account cap, FR-07.01).
    await database.transaction(async (tx) => {
      for (const id of Object.values(ids))
        await tx.execute(sql`DELETE FROM auth.users WHERE id=${id}::uuid`);
    });
  }
}
