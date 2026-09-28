import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../", import.meta.url));
export const secret = () => randomBytes(32).toString("hex");

export function run(
  command,
  args,
  { env = process.env, input, log = "development.log", cwd = repository, timeout = 180000 } = {},
) {
  const output = resolve(repository, ".git", "m0-workers");
  mkdirSync(output, { recursive: true });
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  appendFileSync(resolve(output, log), result.stdout + result.stderr);
  if (result.error || result.status !== 0)
    throw new Error(`Command failed (${command}); inspect .git/m0-workers/${log}`);
  return result.stdout;
}

export function compose(env, args) {
  return run(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      "-f",
      "compose.dev.yaml",
      "-p",
      env.COMPOSE_PROJECT_NAME || "oliginvest-dev",
      ...args,
    ],
    { env, log: "compose.log" },
  );
}

export async function isolatedEnvironment() {
  const servers = [];
  const env = {
    ...process.env,
    NODE_ENV: "test",
    COMPOSE_PROJECT_NAME: `oliginvest-workers-${randomBytes(8).toString("hex")}`,
  };
  try {
    for (const name of [
      "POSTGRES",
      "VALKEY_QUEUE",
      "VALKEY_CACHE",
      "SMTP",
      "MAILPIT_UI",
      "API",
      "WEB",
    ]) {
      const server = createServer();
      servers.push(server);
      await new Promise((accept, reject) => {
        server.once("error", reject);
        server.listen(0, "localhost", accept);
      });
      env[`DEV_${name}_PORT`] = String(server.address().port);
      env.DEV_BIND_ADDRESS = server.address().address;
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise((accept) => server.close(accept))));
  }
  for (const name of ["POSTGRES", "VALKEY_QUEUE", "VALKEY_CACHE"])
    env[`DEV_${name}_PASSWORD`] = secret();
  return env;
}

export function applicationEnvironment(dev) {
  const host = dev.DEV_BIND_ADDRESS;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return {
    NODE_ENV: dev.NODE_ENV,
    PUBLIC_BASE_URL: `http://${urlHost}:${dev.DEV_WEB_PORT || "3000"}`,
    API_INTERNAL_URL: `http://${urlHost}:${dev.DEV_API_PORT || "3001"}`,
    API_HOST: host,
    API_PORT: dev.DEV_API_PORT || "3001",
    DB_HOST: host,
    DB_PORT: dev.DEV_POSTGRES_PORT || "5432",
    DB_NAME: "oliginvest_dev",
    DB_SSL: "false",
    DB_APP_PASSWORD: secret(),
    DB_AUTH_PASSWORD: secret(),
    DB_ANALYTICS_RO_PASSWORD: secret(),
    AUDIT_PSEUDONYM_KEY: secret(),
    BETTER_AUTH_SECRETS: `1:${secret()}`,
    VALKEY_QUEUE_HOST: host,
    VALKEY_QUEUE_PORT: dev.DEV_VALKEY_QUEUE_PORT || "6379",
    VALKEY_QUEUE_USER: "default",
    VALKEY_CACHE_HOST: host,
    VALKEY_CACHE_PORT: dev.DEV_VALKEY_CACHE_PORT || "6380",
    VALKEY_CACHE_USER: "default",
    VALKEY_QUEUE_API_PASSWORD: dev.DEV_VALKEY_QUEUE_PASSWORD,
    VALKEY_QUEUE_JOBS_PASSWORD: dev.DEV_VALKEY_QUEUE_PASSWORD,
    VALKEY_QUEUE_ANALYTICS_PASSWORD: dev.DEV_VALKEY_QUEUE_PASSWORD,
    VALKEY_CACHE_API_PASSWORD: dev.DEV_VALKEY_CACHE_PASSWORD,
    VALKEY_CACHE_JOBS_PASSWORD: dev.DEV_VALKEY_CACHE_PASSWORD,
    JOBS_INSTANCE_ID: "development",
    ANALYTICS_INSTANCE_ID: "development",
  };
}
