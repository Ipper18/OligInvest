import assert from "node:assert/strict";
import pg from "pg";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";
import { prepareDevelopment } from "./prepare-development.mjs";
import { readSeed, seedDevelopment } from "./seed-development.mjs";

const dev = await isolatedEnvironment();
const env = applicationEnvironment(dev);
try {
  compose(dev, ["up", "-d", "--wait", "postgres"]);
  await prepareDevelopment(dev, env);
  const client = new pg.Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: "postgres",
    password: dev.DEV_POSTGRES_PASSWORD,
  });
  await client.connect();
  try {
    const seed = await readSeed();
    const counts = async () =>
      (
        await client.query(`SELECT
      (SELECT count(*)::integer FROM market.bars_daily) AS bars,
      (SELECT count(*)::integer FROM market.fx_rates) AS fx,
      (SELECT count(*)::integer FROM portfolio.transactions) AS transactions,
      (SELECT count(*)::integer FROM market.bars_daily WHERE open IS NOT NULL OR high IS NOT NULL OR low IS NOT NULL) AS invented`)
      ).rows[0];
    assert.deepEqual(await counts(), { bars: 4788, fx: 1596, transactions: 19, invented: 0 });
    await seedDevelopment(client, "test");
    assert.deepEqual(await counts(), { bars: 4788, fx: 1596, transactions: 19, invented: 0 });
    await assert.rejects(seedDevelopment(client, "production"), /explicit/u);
    await assert.rejects(seedDevelopment(client, undefined), /explicit/u);
    const wrong = structuredClone(seed);
    wrong.expected.cash.xtb = "1";
    await assert.rejects(seedDevelopment(client, "test", wrong), /expected mismatch/u);
    const invalid = structuredClone(seed);
    invalid.transactions[0].extra = "invalid";
    await assert.rejects(seedDevelopment(client, "test", invalid));
    const before = await counts();
    await client.query("DELETE FROM auth.users WHERE email=$1", [seed.user.email]);
    await client.query("TRUNCATE market.instruments CASCADE");
    await client.query("TRUNCATE market.fx_rates");
    await assert.rejects(seedDevelopment(client, "test", wrong), /expected mismatch/u);
    assert.equal(
      (await client.query("SELECT count(*)::integer AS count FROM auth.users")).rows[0].count,
      0,
    );
    assert.deepEqual(await counts(), { bars: 0, fx: 0, transactions: 0, invented: 0 });
    await seedDevelopment(client, "test");
    assert.deepEqual(await counts(), before);
    console.log(
      "Seed: all expected values, idempotency, strict input, production guard and atomic rollback PASS",
    );
  } finally {
    await client.end();
  }
} finally {
  compose(dev, ["down", "--volumes", "--remove-orphans"]);
}
