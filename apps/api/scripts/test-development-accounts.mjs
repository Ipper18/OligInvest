import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { IngestionStore } from "@oliginvest/mod-market/jobs";
import { MarketRepository } from "@oliginvest/mod-market/server";
import { ImportRepository, PortfolioRepository } from "@oliginvest/mod-portfolio/server";
import { symmetricDecrypt } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { prepareDevelopment } from "../../../packages/db/scripts/prepare-development.mjs";
import { seedDevelopment } from "../../../packages/db/scripts/seed-development.mjs";
import { persistDevelopmentSecrets } from "../../../scripts/dev-local.mjs";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";
import { AuditWriter } from "../dist/auth/audit.js";
import { createAuth } from "../dist/auth/config.js";
import { AuthService } from "../dist/auth/service.js";
import { totpCode } from "../dist/auth/totp.js";
import { testOwnerBootstrap } from "../integration/bootstrap.mjs";

const directory = await mkdtemp(join(tmpdir(), "oliginvest-accounts-"));
const dev = { ...(await isolatedEnvironment()), NODE_ENV: "development", DEV_PROFILE: "owner" };
const path = join(directory, ".env");
let env = applicationEnvironment(await persistDevelopmentSecrets(dev, path));
const connection = { host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME };
const client = new pg.Client({
  ...connection,
  user: "postgres",
  password: dev.DEV_POSTGRES_PASSWORD,
});
const password = randomBytes(24).toString("hex");
const checks = { compromised: async () => false, unavailable() {} };
let database, appDatabase;
try {
  // All production guards fail before touching a connection, even with local credentials set.
  for (const override of [{ NODE_ENV: "production" }, { DB_NAME: "oliginvest" }]) {
    await assert.rejects(
      prepareDevelopment(dev, { ...env, ...override }),
      /Development database required/u,
    );
    await assert.rejects(persistDevelopmentSecrets({ ...dev, ...override }, path));
  }
  await assert.rejects(seedDevelopment({}, "production", undefined, password), /explicit/u);
  await assert.rejects(seedDevelopment({}, "test", undefined, password), /requires development/u);
  await assert.rejects(
    seedDevelopment(
      { query: async () => ({ rows: [{ name: "oliginvest" }] }) },
      "development",
      undefined,
      password,
    ),
    /Development database required/u,
  );
  compose(dev, ["up", "-d", "--wait", "postgres"]);
  await prepareDevelopment({ ...dev, DEV_DEMO_PASSWORD: password }, env);
  await client.connect();
  for (const table of ["auth.users", "market.instruments", "portfolio.transactions"])
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
  await testOwnerBootstrap({
    ...connection,
    passwords: { auth: env.DB_AUTH_PASSWORD, app: env.DB_APP_PASSWORD },
  });

  // Empty owner catalog: the import cannot guess a broker symbol. The normal Yahoo
  // ingestion path makes it searchable for manual mapping; no provider HTTP in CI.
  appDatabase = createAppDatabase({ ...connection, password: env.DB_APP_PASSWORD });
  const market = new MarketRepository(appDatabase);
  const imports = new ImportRepository(
    new PortfolioRepository(appDatabase, async () => {}),
    async () => {},
  );
  const context = { userId: null, role: "system" };
  const catalog = () => appDatabase.transaction(context, (tx) => imports.catalog(tx, "xtb"));
  assert.deepEqual(imports.match(await catalog(), "xtb", { symbol: "SYNLOCAL.US" }).ids, []);
  await new IngestionStore(market).saveSymbols([
    {
      symbol: "SYNLOCAL",
      name: "Synthetic local instrument",
      mic: "XNAS",
      currency: "USD",
      type: "stock",
    },
  ]);
  const found = await market.search(context, { q: "SYNLOCAL", includeInactive: false, limit: 50 });
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0].mic, "XNAS");
  assert.deepEqual(
    imports.match(await catalog(), "xtb", { symbol: "SYNLOCAL.US" }).ids,
    [],
    "Broker symbols still require the user's mapping",
  );
  await appDatabase.close();
  await client.query("DELETE FROM market.instruments WHERE id=$1", [found.data[0].id]);

  await assert.rejects(seedDevelopment(client, "development", undefined, "short", checks), {
    code: "VALIDATION_FAILED",
  });
  await assert.rejects(
    seedDevelopment(client, "development", undefined, password, {
      ...checks,
      compromised: async () => true,
    }),
    { code: "VALIDATION_FAILED" },
  );
  assert.equal((await client.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n, 0);
  // Upgrade an old seed without a credential, then verify idempotence.
  await seedDevelopment(client, "development");
  await seedDevelopment(client, "development", undefined, password, checks);
  const credential = () =>
    client.query("SELECT password FROM auth.accounts WHERE provider_id='credential'");
  const encoded = (await credential()).rows[0].password;
  assert.match(encoded, /^\$argon2id\$/u);
  await seedDevelopment(client, "development", undefined, password, checks);
  assert.equal((await credential()).rows[0].password, encoded);
  await assert.rejects(
    seedDevelopment(client, "development", undefined, randomBytes(24).toString("hex"), checks),
    /Demo password differs/u,
  );

  const cookies = new Map();
  const steps = new Map();
  const state = {
    limit: async () => {},
    failures: async () => 0,
    failed: async () => {},
    succeeded: async () => {},
    consumeStep: async (id, step) => {
      if ((steps.get(id) ?? -1) >= step) return false;
      steps.set(id, step);
      return true;
    },
  };
  function runtime() {
    database = createAuthDatabase({ ...connection, password: env.DB_AUTH_PASSWORD });
    appDatabase = createAppDatabase({ ...connection, password: env.DB_APP_PASSWORD });
    const configuration = {
      origin: "https://example.test",
      secrets: [{ version: 1, value: env.BETTER_AUTH_SECRETS.slice(2) }],
      trustedProxies: [],
      sendReset: async () => {},
    };
    return new AuthService({
      database,
      appDatabase,
      configuration,
      state,
      passwordChecks: checks,
      audit: new AuditWriter(appDatabase, env.AUDIT_PSEUDONYM_KEY),
      securityEvent: async () => {},
      event() {},
      wait: async () => {},
    });
  }
  let service = runtime();
  const request = (route, body) =>
    new Request(`https://example.test/api/auth${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: "https://example.test",
        "content-type": "application/json",
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function call(route, body) {
    const response = await service.handle(request(route, body), "127.0.0.1");
    assert.equal(response.status, 200, route);
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0],
        at = pair.indexOf("=");
      if (/Max-Age=0/iu.test(header)) cookies.delete(pair.slice(0, at));
      else cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response.json();
  }
  await call("/sign-in/email", { email: "dev@example.invalid", password });
  await assert.rejects(service.requireData(request("/get-session")), {
    code: "MFA_ENROLLMENT_REQUIRED",
  });
  const setup = await call("/two-factor/enable", { password });
  const secret = await database.transaction(async (tx) => {
    const { secretConfig } = await createAuth(tx, service.options.configuration).$context;
    const row = (await tx.execute(sql`SELECT secret FROM auth.two_factors`)).rows[0];
    return symmetricDecrypt({ key: secretConfig, data: row.secret });
  });
  await call("/two-factor/verify-totp", {
    code: totpCode(secret, Math.floor(Date.now() / 30000) - 1),
  });
  await assert.rejects(service.requireData(request("/get-session")), {
    code: "TERMS_ACCEPTANCE_REQUIRED",
  });
  const principal = await service.principal(request("/get-session"));
  await service.recordConsents(principal.user_id, false, "admin");
  assert.equal((await service.requireData(request("/get-session"))).user_id, principal.user_id);

  // Actual new pools + rotated DB role passwords, but the same .env encryption keys.
  await Promise.all([database.close(), appDatabase.close()]);
  env = applicationEnvironment(await persistDevelopmentSecrets(dev, path));
  await prepareDevelopment(dev, env);
  service = runtime();
  assert.equal((await service.requireData(request("/get-session"))).user_id, principal.user_id);
  cookies.clear();
  await call("/sign-in/email", { email: "dev@example.invalid", password });
  await call("/two-factor/verify-totp", { code: totpCode(secret, Math.floor(Date.now() / 30000)) });
  assert.equal((await service.requireData(request("/get-session"))).user_id, principal.user_id);
  cookies.clear();
  await call("/sign-in/email", { email: "dev@example.invalid", password });
  await call("/two-factor/verify-backup-code", { code: setup.backupCodes[0] });
  assert.equal((await service.requireData(request("/get-session"))).mfa_method, "backup");
  console.log(
    "Local accounts: empty owner bootstrap, demo policy, MFA/legal gates, restart with TOTP and backup code PASS",
  );
} finally {
  await Promise.all([database?.close(), appDatabase?.close(), client.end()]);
  compose(dev, ["down", "--volumes", "--remove-orphans"]);
  await rm(directory, { recursive: true, force: true });
}
