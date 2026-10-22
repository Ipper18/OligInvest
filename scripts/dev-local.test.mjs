import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { persistDevelopmentSecrets } from "./dev-local.mjs";
import { applicationEnvironment } from "./dev-services.mjs";

const development = { NODE_ENV: "development", DB_NAME: "oliginvest_dev", DEV_BIND_ADDRESS: "127.0.0.1" };

test("keys survive restarts; role passwords remain ephemeral; existing .env is preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oliginvest-dev-"));
  const path = join(directory, ".env");
  try {
    await writeFile(path, "# retained\nDEV_AUTH_SECRET=\nDEV_AUDIT_KEY=\n");
    const first = applicationEnvironment(await persistDevelopmentSecrets(development, path));
    const saved = await readFile(path, "utf8");
    const second = applicationEnvironment(await persistDevelopmentSecrets(development, path));
    assert.equal(first.BETTER_AUTH_SECRETS, second.BETTER_AUTH_SECRETS);
    assert.equal(first.AUDIT_PSEUDONYM_KEY, second.AUDIT_PSEUDONYM_KEY);
    assert.notEqual(first.DB_AUTH_PASSWORD, second.DB_AUTH_PASSWORD);
    assert.equal(await readFile(path, "utf8"), saved);
    assert.ok(saved.startsWith("# retained\n"));
    await assert.rejects(persistDevelopmentSecrets({ ...development, DEV_AUTH_SECRET: "a".repeat(64) }, path), /Conflicting/u);
    for (const env of [
      { ...development, NODE_ENV: "production" },
      { ...development, NODE_ENV: "test" },
      { ...development, DB_NAME: "oliginvest" },
    ]) {
      await assert.rejects(persistDevelopmentSecrets(env, path), /require development/u);
      assert.equal(await readFile(path, "utf8"), saved);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("application environment rejects production and foreign databases before generating credentials", () => {
  for (const env of [{ ...development, NODE_ENV: "production" }, { ...development, DB_NAME: "oliginvest" }])
    assert.throws(() => applicationEnvironment(env), /Development database required/u);
  assert.throws(() => applicationEnvironment(development), /Missing persistent/u);
});
