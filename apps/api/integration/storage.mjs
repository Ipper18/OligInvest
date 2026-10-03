import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createAuthDatabase } from "@oliginvest/db";
import { symmetricDecrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { createAuth } from "../dist/auth/config.js";

// Called by db:test against real PostgreSQL 18 after normative RLS tests.
export async function testAuthStorage(settings) {
  const database = createAuthDatabase({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.passwords.auth,
  });
  const oldSecret = { version: 1, value: randomBytes(32).toString("hex") };
  const nextSecret = { version: 2, value: randomBytes(32).toString("hex") };
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("hex");
  const configuration = {
    origin: "https://example.test",
    secrets: [oldSecret],
    trustedProxies: [],
    sendReset: async () => {},
  };
  let userId;
  try {
    await database.transaction(async (tx) => {
      const auth = createAuth(tx, configuration);
      const response = await auth.handler(
        new Request("https://example.test/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://example.test" },
          body: JSON.stringify({ name: "Synthetic", email, password }),
        }),
      );
      assert.equal(response.status, 200, "PostgreSQL-backed Better Auth registration must succeed");
      const created = await response.json();
      userId = created.user.id;
      const account = (
        await tx.execute(sql`SELECT password FROM auth.accounts WHERE user_id = ${userId}::uuid`)
      ).rows[0];
      assert.match(account.password, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      for (const value of response.headers.getSetCookie()) {
        assert.match(value, /^__Host-oliginvest\./u);
        assert.match(value, /; Secure/iu);
        assert.match(value, /; HttpOnly/iu);
        assert.match(value, /; Path=\//iu);
        assert.doesNotMatch(value, /; Domain=/iu);
      }
      const enable = await auth.handler(
        new Request("https://example.test/api/auth/two-factor/enable", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://example.test", cookie },
          body: JSON.stringify({ password }),
        }),
      );
      assert.equal(enable.status, 200, "SQL adapter must support encrypted two-factor enrollment");
      const enrolled = await enable.json();
      const stored = (
        await tx.execute(
          sql`SELECT secret, backup_codes FROM auth.two_factors WHERE user_id = ${userId}::uuid`,
        )
      ).rows[0];
      assert.equal(enrolled.backupCodes.length, 10);
      assert.ok(enrolled.backupCodes.every((code) => !stored.backup_codes.includes(code)));
      const secret = new URL(enrolled.totpURI).searchParams.get("secret");
      assert.notEqual(stored.secret, secret);
      const rotated = createAuth(tx, { ...configuration, secrets: [nextSecret, oldSecret] });
      const context = await rotated.$context;
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const bits = [...secret]
        .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
        .join("");
      const decoded = Buffer.from(
        bits.match(/.{8}/gu).map((byte) => Number.parseInt(byte, 2)),
      ).toString("utf8");
      assert.equal(
        await symmetricDecrypt({ key: context.secretConfig, data: stored.secret }),
        decoded,
      );
      assert.deepEqual(
        JSON.parse(
          await symmetricDecrypt({ key: context.secretConfig, data: stored.backup_codes }),
        ),
        enrolled.backupCodes,
      );
    });
  } finally {
    if (userId)
      await database.transaction((tx) =>
        tx.execute(sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`),
      );
    await database.close();
  }
}
