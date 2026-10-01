import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { seedDevelopment } from "./seed-development.mjs";

export async function prepareDevelopment(dev, env) {
  if (!["development", "test"].includes(env.NODE_ENV) || env.DB_NAME !== "oliginvest_dev")
    throw new Error("Development database required");
  const client = new pg.Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    user: "postgres",
    password: dev.DEV_POSTGRES_PASSWORD,
  });
  await client.connect();
  try {
    for (const path of ["../sql/bootstrap.sql", "../admin-migrations/0001-role-timeouts.sql"])
      await client.query(await readFile(new URL(path, import.meta.url), "utf8"));
    await client.query("SET ROLE oliginvest_owner");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL("../migrations/", import.meta.url)),
    });
    await client.query("RESET ROLE");
    await client.query(
      `SELECT set_config('oliginvest_dev.app_password',$1,false), set_config('oliginvest_dev.auth_password',$2,false), set_config('oliginvest_dev.analytics_password',$3,false)`,
      [env.DB_APP_PASSWORD, env.DB_AUTH_PASSWORD, env.DB_ANALYTICS_RO_PASSWORD],
    );
    await client.query(`DO $$ BEGIN
      EXECUTE format('ALTER ROLE oliginvest_app PASSWORD %L', current_setting('oliginvest_dev.app_password'));
      EXECUTE format('ALTER ROLE oliginvest_auth PASSWORD %L', current_setting('oliginvest_dev.auth_password'));
      EXECUTE format('ALTER ROLE oliginvest_analytics_ro PASSWORD %L', current_setting('oliginvest_dev.analytics_password'));
    END $$`);
    await seedDevelopment(client, env.NODE_ENV);
  } finally {
    await client.end();
  }
}
