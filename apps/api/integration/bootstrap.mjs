import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { sql } from "drizzle-orm";
import { AuditWriter } from "../dist/auth/audit.js";
import { createOwner } from "../dist/auth/bootstrap.js";
import { createAuth } from "../dist/auth/config.js";
import { verifyPassword } from "../dist/auth/password.js";

export async function testOwnerBootstrap(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const appDatabase = createAppDatabase({ ...connection, password: settings.passwords.app });
  const key = randomBytes(32).toString("hex");
  const audit = new AuditWriter(appDatabase, key);
  const dependencies = {
    database,
    appDatabase,
    audit,
    passwordChecks: { compromised: async () => false, unavailable: () => {} },
  };
  const input = {
    email: `${randomUUID()}@example.test`,
    name: "Owner",
    password: randomBytes(24).toString("hex"),
    reason: "Synthetic bootstrap test",
    emailOwnershipConfirmed: true,
    termsVersion: "2026-09",
    privacyNoticeVersion: "2026-09",
  };
  let id;
  try {
    assert.equal(
      (await database.transaction((tx) => tx.execute(sql`SELECT id FROM auth.users`))).rows.length,
      0,
      "Bootstrap test requires an empty database",
    );
    await assert.rejects(
      () => createOwner({ ...input, password: "oliginvest1234" }, dependencies),
      {
        code: "VALIDATION_FAILED",
      },
    );
    await assert.rejects(
      () => createOwner({ ...input, emailOwnershipConfirmed: false }, dependencies),
      { code: "VALIDATION_FAILED" },
    );
    await assert.rejects(() => createOwner({ ...input, termsVersion: "2020-01" }, dependencies), {
      code: "VALIDATION_FAILED",
    });
    await assert.rejects(() =>
      createOwner(input, {
        ...dependencies,
        audit: {
          record: async () => {
            throw new Error("Synthetic audit outage");
          },
        },
      }),
    );
    assert.equal(
      (await database.transaction((tx) => tx.execute(sql`SELECT id FROM auth.users`))).rows.length,
      0,
    );
    const outcomes = await Promise.allSettled([
      createOwner(input, dependencies),
      createOwner({ ...input, email: `${randomUUID()}@example.test` }, dependencies),
    ]);
    const success = outcomes.filter((result) => result.status === "fulfilled");
    assert.equal(success.length, 1, "Exactly one concurrent bootstrap succeeds");
    assert.equal(outcomes.find((result) => result.status === "rejected").reason.code, "CONFLICT");
    id = success[0].value.id;
    const users = (
      await database.transaction((tx) =>
        tx.execute(sql`SELECT id,email,role,email_verified,two_factor_enabled FROM auth.users`),
      )
    ).rows;
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "admin");
    assert.equal(users[0].email_verified, true);
    assert.equal(users[0].two_factor_enabled, false);
    const hash = (
      await database.transaction((tx) =>
        tx.execute(sql`SELECT password FROM auth.accounts WHERE user_id=${id}::uuid`),
      )
    ).rows[0].password;
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    assert.equal(await verifyPassword({ hash, password: input.password }), true);
    assert.equal(
      (await database.transaction((tx) => tx.execute(sql`SELECT id FROM auth.sessions`))).rows
        .length,
      0,
    );
    const consents = (
      await appDatabase.transaction({ userId: id, role: "admin" }, (tx) =>
        tx.execute(sql`SELECT document,version,action FROM identity.consent_events`),
      )
    ).rows;
    assert.deepEqual(consents.map((row) => row.document).sort(), ["privacy_notice", "terms"]);
    const log = (
      await appDatabase.transaction({ userId: id, role: "admin" }, (tx) =>
        tx.execute(
          sql`SELECT actor_ref,actor_type,action,outcome,"after" FROM platform.audit_log WHERE action='cli.create-owner'`,
        ),
      )
    ).rows;
    assert.equal(log.filter((row) => row.outcome === "success").length, 1);
    assert.ok(log.some((row) => row.outcome === "denied"));
    assert.ok(
      log.every((row) => row.actor_type === "system" && /^[a-f0-9]{64}$/u.test(row.actor_ref)),
    );
    assert.ok(!JSON.stringify(log).includes(input.password));
    await assert.rejects(() =>
      appDatabase.transaction({ userId: id, role: "admin" }, (tx) =>
        tx.execute(sql`DELETE FROM platform.audit_log`),
      ),
    );
    const configuration = {
      origin: "https://example.test",
      secrets: [{ version: 1, value: key }],
      trustedProxies: [],
      sendReset: async () => {},
    };
    await database.transaction(async (tx) => {
      const response = await createAuth(tx, configuration).handler(
        new Request(`${configuration.origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin: configuration.origin, "content-type": "application/json" },
          body: JSON.stringify({ email: users[0].email, password: input.password }),
        }),
      );
      assert.equal(
        response.status,
        200,
        "Owner can authenticate using the ordinary Better Auth flow",
      );
    });
  } finally {
    if (id)
      await database.transaction((tx) =>
        tx.execute(sql`DELETE FROM auth.users WHERE id=${id}::uuid`),
      );
    await Promise.all([database.close(), appDatabase.close()]);
  }
}
