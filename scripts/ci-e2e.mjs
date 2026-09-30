import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { prepareDevelopment } from "../packages/db/scripts/prepare-development.mjs";
import { applicationEnvironment, compose, isolatedEnvironment, repository, run } from "./dev-services.mjs";

const dev = await isolatedEnvironment();
const app = applicationEnvironment(dev);
const secretDirectory = mkdtempSync(join(repository, ".git", "e2e-secrets-"));
let api;
try {
  run(process.execPath, ["node_modules/turbo/bin/turbo", "run", "build", "--filter=@oliginvest/web", "--filter=@oliginvest/api", "--filter=@oliginvest/db", "--output-logs=new-only"], { log: "e2e-build.log" });
  compose(dev, ["up", "-d", "--wait"]);
  await prepareDevelopment(dev, app);
  const production = { ...process.env, ...app, NODE_ENV: "production", PUBLIC_BASE_URL: "https://example.test" };
  for (const key of ["BETTER_AUTH_SECRETS", "AUDIT_PSEUDONYM_KEY", "DB_AUTH_PASSWORD", "DB_APP_PASSWORD", "VALKEY_QUEUE_API_PASSWORD", "VALKEY_CACHE_API_PASSWORD"]) {
    const path = join(secretDirectory, key);
    writeFileSync(path, production[key], { mode: 0o600 });
    delete production[key];
    production[`${key}_FILE`] = path;
  }
  api = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: repository,
    env: production,
    stdio: "ignore",
  });
  await once(api, "spawn");
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) throw new Error("Production API exited before readiness");
    try {
      const result = await fetch(`${app.API_INTERNAL_URL}/api/v1/health/ready`, { signal: AbortSignal.timeout(1000) });
      if (result.ok) { ready = true; break; }
    } catch { /* Wait for process startup. */ }
    await new Promise((accept) => setTimeout(accept, 200));
  }
  if (!ready) throw new Error("Production API dependencies are not ready");
  run(process.execPath, ["apps/web/node_modules/@playwright/test/cli.js", "test", "--config=apps/web/playwright.config.ts"], {
    env: { ...process.env, E2E_API_URL: app.API_INTERNAL_URL },
    log: "e2e-playwright.log",
    timeout: 600000,
  });
  console.log("E2E: Chromium, WebKit, Firefox + axe + production API / Compose PASS");
} finally {
  if (api && api.exitCode === null) {
    const stopped = once(api, "exit");
    api.kill();
    const deadline = setTimeout(() => api.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(deadline);
  }
  try {
    compose(dev, ["down", "--volumes", "--remove-orphans"]);
  } finally {
    const inside = relative(join(repository, ".git"), secretDirectory);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("Unsafe secret cleanup");
    rmSync(secretDirectory, { recursive: true, force: true });
  }
}
