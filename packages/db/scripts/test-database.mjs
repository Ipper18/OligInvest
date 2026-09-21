import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { normalizeSchemaDump } from "./schema-dump.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const gitPath = spawnSync("git", ["rev-parse", "--git-path", "bl007-db"], {
  cwd: repository,
  encoding: "utf8",
});
if (gitPath.status !== 0) throw new Error("Cannot locate database test output directory");
const output = resolve(repository, gitPath.stdout.trim());
const project = `oliginvest-db-test-${randomBytes(8).toString("hex")}`;
const container = `${project}-postgres-1`;
const compose = ["compose", "--env-file", ".env.example", "-f", "compose.dev.yaml", "-p", project];
const reference = "bl007_reference";
const migrated = "bl007_migrated";
const server = createServer();
await new Promise((accept, reject) => {
  server.once("error", reject);
  server.listen(0, "localhost", accept);
});
const { port, address: host } = server.address();
await new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())));
const password = randomBytes(32).toString("hex");
const environment = {
  ...process.env,
  DEV_BIND_ADDRESS: host,
  DEV_POSTGRES_PORT: String(port),
  DEV_POSTGRES_PASSWORD: password,
  DEV_VALKEY_QUEUE_PASSWORD: randomBytes(32).toString("hex"),
  DEV_VALKEY_CACHE_PASSWORD: randomBytes(32).toString("hex"),
};

function docker(args, input) {
  const result = spawnSync("docker", args, {
    cwd: repository,
    env: environment,
    input,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stderr) appendFileSync(resolve(output, "docker.log"), result.stderr);
  if (result.error || result.status !== 0) {
    // Never include connection credentials or the environment in errors.
    throw new Error(
      `Docker command failed: ${result.error?.code ?? result.status}; inspect .git/bl007-db/docker.log`,
    );
  }
  return result.stdout;
}

async function withClient(database, action) {
  const client = new pg.Client({ host, port, password, user: "postgres", database });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

function psql(database, sql) {
  return docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
    ],
    sql,
  );
}

function dump(database) {
  return normalizeSchemaDump(
    docker([
      "exec",
      container,
      "pg_dump",
      "--schema-only",
      "--create",
      "--exclude-schema=drizzle",
      "-U",
      "postgres",
      database,
    ]),
    database,
  );
}

await mkdir(output, { recursive: true });
try {
  console.log("Starting isolated PostgreSQL 18 from compose.dev.yaml");
  docker([...compose, "up", "-d", "--wait", "postgres"]);
  await withClient("postgres", async (client) => {
    const version = (await client.query("SHOW server_version_num")).rows[0].server_version_num;
    assert.equal(Math.trunc(Number(version) / 10_000), 18, "PostgreSQL 18 is required");
    await client.query("CREATE DATABASE bl007_reference");
    await client.query("CREATE DATABASE bl007_migrated");
    console.log(`PostgreSQL ${version}: fresh databases created`);
  });
  const ddl = await readFile(resolve(repository, "docs/03-dane/schema.sql"), "utf8");
  psql(migrated, await readFile(resolve(repository, "packages/db/sql/bootstrap.sql"), "utf8"));
  await withClient(migrated, async (client) => {
    await client.query("SET ROLE oliginvest_owner");
    assert.equal(
      (await client.query("SELECT current_user")).rows[0].current_user,
      "oliginvest_owner",
    );
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: resolve(repository, "packages/db/migrations") });
    // The second run must leave both the journal and schema unchanged.
    const journal = await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id");
    await migrate(db, { migrationsFolder: resolve(repository, "packages/db/migrations") });
    assert.deepEqual(
      (await client.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
      journal.rows,
    );
  });
  psql(
    migrated,
    await readFile(resolve(repository, "packages/db/test/consent-version.sql"), "utf8"),
  );
  console.log("Consent version CHECK: dotted suffix accepted, x suffix rejected");
  // Audit bootstrap before the reference can supply any missing global role grants.
  const rlsOutput = psql(
    migrated,
    await readFile(resolve(repository, "docs/03-dane/testy-rls.sql"), "utf8"),
  );
  await writeFile(resolve(output, "rls.log"), rlsOutput);
  assert.ok(rlsOutput.includes("ALL RLS SMOKE TESTS PASSED"), "RLS scenarios did not finish");
  psql(
    migrated,
    await readFile(resolve(repository, "packages/db/test/security-catalog.sql"), "utf8"),
  );
  console.log("Normative RLS scenarios and full security catalog audit: PASS");
  psql(reference, ddl);
  const expected = dump(reference);
  const actual = dump(migrated);
  await writeFile(resolve(output, "reference.sql"), expected);
  await writeFile(resolve(output, "migrated.sql"), actual);
  if (actual !== expected)
    throw new Error("Schema mismatch: inspect .git/bl007-db/reference.sql and migrated.sql");
  console.log(
    "Schema comparison: ZERO DIFFERENCES (including owners, ACLs, RLS, functions, triggers and comments)",
  );
} finally {
  // Only this invocation's random Compose project; never the developer's project.
  docker([...compose, "down", "--volumes", "--remove-orphans"]);
}
