import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { prepareDevelopment } from "../packages/db/scripts/prepare-development.mjs";
import { seedBrowserInvitations } from "../apps/api/integration/browser-seed.mjs";
import { applicationEnvironment, compose, isolatedEnvironment, repository, run } from "./dev-services.mjs";

const dev = await isolatedEnvironment();
const app = applicationEnvironment(dev);
const secretDirectory = mkdtempSync(join(repository, ".git", "e2e-secrets-"));
let api;
let worker;
try {
  run(process.execPath, ["node_modules/turbo/bin/turbo", "run", "build", "--filter=@oliginvest/web", "--filter=@oliginvest/api", "--filter=@oliginvest/jobs", "--filter=@oliginvest/db", "--output-logs=new-only"], { log: "e2e-build.log" });
  compose(dev, ["up", "-d", "--wait"]);
  await prepareDevelopment(dev, app);
  const browserFixture = join(secretDirectory, "browser.json");
  writeFileSync(browserFixture, JSON.stringify(await seedBrowserInvitations(dev, app)), { mode: 0o600 });
  worker = spawn(process.execPath, ["apps/jobs/test/browser-worker.mjs"], {
    cwd: repository, env: { ...process.env, ...app }, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await Promise.race([
    once(worker, "message"),
    once(worker, "exit").then(() => { throw new Error("Import worker exited before readiness"); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Import worker readiness timeout")), 30000); timer.unref(); }),
  ]);
  const production = { ...process.env, ...app, NODE_ENV: "production", PUBLIC_BASE_URL: "https://127.0.0.1:3196" };
  for (const key of ["BETTER_AUTH_SECRETS", "AUDIT_PSEUDONYM_KEY", "DB_AUTH_PASSWORD", "DB_APP_PASSWORD", "VALKEY_QUEUE_API_PASSWORD", "VALKEY_CACHE_API_PASSWORD"]) {
    const path = join(secretDirectory, key);
    writeFileSync(path, production[key], { mode: 0o600 });
    delete production[key];
    production[`${key}_FILE`] = path;
  }
  api = spawn(process.execPath, ["--import", "./apps/api/integration/browser-network.mjs", "apps/api/dist/server.js"], {
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
  run(process.execPath, ["apps/web/node_modules/@playwright/test/cli.js", "test", "--config=apps/web/playwright.config.ts", ...process.argv.slice(2).filter((arg) => arg !== "--")], {
    env: { ...process.env, E2E_API_URL: app.API_INTERNAL_URL, E2E_BROWSER_FIXTURE: browserFixture },
    log: "e2e-playwright.log",
    timeout: 600000,
  });
  console.log("E2E: selected browser scenarios + axe + production API / Compose PASS");
} finally {
  if (worker && worker.exitCode === null) {
    const stopped = once(worker, "exit");
    worker.kill();
    const deadline = setTimeout(() => worker.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(deadline);
  }
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
