import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { prepareDevelopment } from "../packages/db/scripts/prepare-development.mjs";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
  repository,
  run,
} from "./dev-services.mjs";
import { childEnvironment } from "./dev-environment.mjs";
import { testMailpit } from "./test-mailpit.mjs";

const checking = process.argv[2] === "--check";
if (process.argv.length > (checking ? 3 : 2)) throw new Error("Unexpected arguments");
const children = [];
let stopping = false;
let dev;


function start(command, args, env, service) {
  const child = spawn(command, args, {
    cwd: repository,
    env: childEnvironment(env, service),
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  child.once("error", () => {
    process.exitCode = 1;
    void stop();
  });
  child.once("exit", (code) => {
    if (!stopping) {
      console.error(`${service} exited (${code})`);
      process.exitCode = 1;
      void stop();
    }
  });
  return child;
}

async function stop() {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || !child.pid) return;
      const exited = once(child, "exit").catch(() => undefined);
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
      const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(deadline);
    }),
  );
}

async function waitFor(url) {
  const deadline = Date.now() + 60000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
    } catch {
      /* Services are still starting. */
    }
    await new Promise((accept) => setTimeout(accept, 200));
  }
  throw new Error("Development readiness timed out");
}

try {
  if (checking) {
    dev = { ...(await isolatedEnvironment()), NODE_ENV: "development" };
  } else {
    let file = {};
    try {
      file = parseEnv(await readFile(resolve(repository, ".env"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    dev = { ...file, ...process.env };
    if (dev.NODE_ENV !== "development")
      throw new Error("pnpm dev requires explicit NODE_ENV=development");
    if (
      !isIP(dev.DEV_BIND_ADDRESS) ||
      !(dev.DEV_BIND_ADDRESS === "::1" || dev.DEV_BIND_ADDRESS.startsWith("127."))
    )
      throw new Error("DEV_BIND_ADDRESS must be loopback");
    for (const key of [
      "DEV_POSTGRES_PASSWORD",
      "DEV_VALKEY_QUEUE_PASSWORD",
      "DEV_VALKEY_CACHE_PASSWORD",
    ])
      if (!dev[key]?.trim()) throw new Error(`Missing ${key}`);
    const passwords = [
      dev.DEV_POSTGRES_PASSWORD,
      dev.DEV_VALKEY_QUEUE_PASSWORD,
      dev.DEV_VALKEY_CACHE_PASSWORD,
    ];
    if (new Set(passwords).size !== passwords.length)
      throw new Error("Use separate development passwords");
  }
  const env = applicationEnvironment(dev);
  const turbo = resolve(repository, "node_modules/turbo/bin/turbo");
  run(
    process.execPath,
    [
      turbo,
      "run",
      "build",
      "--filter=@oliginvest/api",
      "--filter=@oliginvest/jobs",
      "--filter=@oliginvest/db",
      "--filter=@oliginvest/ui",
      "--filter=@oliginvest/i18n",
      "--output-logs=new-only",
    ],
    { log: "dev-build.log" },
  );
  compose(dev, ["up", "-d", "--wait"]);
  await prepareDevelopment(dev, env);
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  start(process.execPath, ["apps/api/dist/server.js"], env, "api");
  start(process.execPath, ["apps/jobs/dist/server.js"], env, "jobs");
  const python = resolve(
    repository,
    "apps/analytics/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  start(python, ["-m", "oliginvest_analytics"], env, "analytics");
  start(
    process.execPath,
    [
      "apps/web/node_modules/next/dist/bin/next",
      "dev",
      "apps/web",
      "--hostname",
      env.API_HOST,
      "--port",
      dev.DEV_WEB_PORT || "3000",
    ],
    env,
    "web",
  );
  await waitFor(`${env.API_INTERNAL_URL}/api/v1/health/ready`);
  await waitFor(env.PUBLIC_BASE_URL);
  console.log(`Development ready: ${env.PUBLIC_BASE_URL}`);
  if (checking) {
    run(process.execPath, ["apps/jobs/dist/healthcheck.js"], {
      env: childEnvironment(env, "jobs"),
      log: "dev-health.log",
    });
    run(python, ["-m", "oliginvest_analytics", "--health"], {
      env: childEnvironment(env, "analytics"),
      log: "dev-health.log",
    });
    const host = env.API_HOST.includes(":") ? `[${env.API_HOST}]` : env.API_HOST;
    assert.equal((await fetch(`http://${host}:${dev.DEV_MAILPIT_UI_PORT}/livez`)).status, 200);
    await testMailpit(env.API_HOST, dev.DEV_SMTP_PORT, dev.DEV_MAILPIT_UI_PORT);
    const { testQueuedAuthMail } = await import("../apps/jobs/scripts/test-auth-mail.mjs");
    await testQueuedAuthMail(childEnvironment(env, "jobs"), dev.DEV_MAILPIT_UI_PORT);
    const { testAuthState } = await import("../apps/api/integration/state.mjs");
    await testAuthState(childEnvironment(env, "api"));
    console.log("pnpm dev entry point: API, web, jobs, analytics and Compose readiness PASS");
    await stop();
  }
} catch (error) {
  console.error(
    checking
      ? error.message
      : "Development startup failed; check local configuration and .git/m0-workers logs.",
  );
  process.exitCode = 1;
  await stop();
} finally {
  if (checking && dev) compose(dev, ["down", "--volumes", "--remove-orphans"]);
}
