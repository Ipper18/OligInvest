import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { z } from "zod";

const schema = z
  .object({
    DB_HOST: z.string().regex(/^[a-zA-Z0-9.:[\]_-]+$/u),
    DB_PORT: z.coerce.number().int().min(1).max(65535),
    DB_NAME: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    DB_OWNER_PASSWORD_FILE: z.string().startsWith("/run/secrets/"),
  })
  .strict();
let client;
try {
  const config = schema.parse(
    Object.fromEntries(Object.keys(schema.shape).map((key) => [key, process.env[key]])),
  );
  const password = (await readFile(config.DB_OWNER_PASSWORD_FILE, "utf8")).replace(/\r?\n$/u, "");
  z.string().min(32).max(65536).parse(password);
  client = new pg.Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: "oliginvest_owner",
    password,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  await client.query("SELECT pg_advisory_lock(20261001)");
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../migrations/", import.meta.url)),
  });
  console.log("Database migrations complete");
} catch {
  console.error("Database migration failed");
  process.exitCode = 1;
} finally {
  await client?.end();
}
