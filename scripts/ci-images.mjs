import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, ".git/m0-2-images");
mkdirSync(output, { recursive: true });
const python = "python:3.13.13-slim-trixie@sha256:aa938a849bcb82dce8f49480f056ab82bf5c1c3ebc294f0430f37b6820e7f286";
const project = `oliginvest-images-${randomBytes(5).toString("hex")}`;
const state = `${project}-secrets`;
const environment = { ...process.env };
function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, env: environment, encoding: "utf8", timeout: 1_800_000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (options.log) writeFileSync(resolve(output, options.log), result.stdout + result.stderr);
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${binary} ${args[0]}; ${options.log ?? "integration assertion"}\n${options.log ? "" : result.stderr}`);
  return result.stdout.trim();
}
const docker = (args, options) => run("docker", args, options);
const catalog = JSON.parse(docker(["run", "--rm", "--network=none", "--mount", `type=bind,source=${root},target=/source,readonly`, python, "python", "-c", "import importlib.util,json; s=importlib.util.spec_from_file_location('catalog','/source/infra/scripts/secret-files.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(m.matrix()))"]));
for (const service of Object.keys(catalog)) {
  const node = ["web", "api", "jobs", "migrate"].includes(service);
  const valkey = service.startsWith("valkey-");
  const file = node ? "node" : valkey ? "valkey" : service;
  const reference = `oliginvest-local/${service}:m0-2`;
  environment[`${service.replaceAll("-", "_").toUpperCase()}_IMAGE`] = reference;
  if (!process.argv.includes("--skip-build")) {
    console.log(`Building ${service}`);
    docker(["build", "-f", `infra/docker/${file}.Dockerfile`, ...(node || valkey ? ["--target", service] : []), "-t", reference, "."], { log: `build-${service}.log` });
  }
  assert.equal(docker(["image", "inspect", reference, "--format", "{{.Config.User}}"]), `${catalog[service].uid}:${catalog[service].gid}`);
}
if (process.argv.includes("--build-only")) process.exit(0);
const server = createServer();
await new Promise((accept) => server.listen(0, "localhost", accept));
const { port, address } = server.address();
await new Promise((accept) => server.close(accept));
Object.assign(environment, { PUBLIC_BASE_URL: `https://localhost:${port}`, ACME_EMAIL: "ci@example.test", VPS_TUNNEL_CIDR: `${address}/${address.includes(":") ? 128 : 32}`, HTTPS_BIND_ADDRESS: address, HTTPS_PORT: String(port) });
const overlayPath = resolve(output, "secrets.json");
const testPath = resolve(output, "test.json");
const composeArgs = ["compose", "-p", project, "-f", "compose.yaml", "-f", overlayPath, "-f", testPath];
const compose = (args, options) => docker([...composeArgs, ...args], options);
try {
  docker(["volume", "create", state]);
  docker(["run", "--rm", "--network=none", "--mount", `type=bind,source=${root},target=/source,readonly`, "--mount", `type=volume,source=${state},target=/state`, python, "sh", "-ec", "python /source/infra/tests/test-secrets.py && python /source/infra/scripts/secret-files.py --root /state"], { log: "secrets.log" });
  const source = docker(["volume", "inspect", state, "--format", "{{.Mountpoint}}"]);
  const json = docker(["run", "--rm", "--network=none", "--mount", `type=volume,source=${state},target=/state,readonly`, python, "cat", "/state/runtime-compose.json"]);
  const overlay = JSON.parse(json);
  for (const entry of Object.values(overlay.secrets)) entry.file = entry.file.replace("/state/", `${source}/`);
  writeFileSync(overlayPath, JSON.stringify(overlay));
  writeFileSync(testPath, JSON.stringify({ services: { caddy: { volumes: [{ type: "bind", source: resolve(root, "infra/caddy/Caddyfile.test"), target: "/etc/caddy/Caddyfile", read_only: true }] } } }));
  for (const [service, row] of Object.entries(catalog)) {
    const expected = row.required.toSorted();
    const script = `set -eu; test "$(id -u):$(id -g)" = '${row.uid}:${row.gid}'; for name in ${expected.join(" ")}; do test -r /run/secrets/$name; test ! -w /run/secrets/$name; done; if test -d /run/secrets; then ls -1 /run/secrets; fi`;
    const actual = compose(["run", "--rm", "--no-deps", "--entrypoint", "sh", service, "-ec", script]);
    assert.deepEqual(actual ? actual.split(/\r?\n/u).toSorted() : [], expected, `${service}: unexpected secret mount`);
  }
  console.log("All nine image USERs and secret mounts PASS");
  compose(["up", "-d", "--wait", "postgres", "valkey-queue", "valkey-cache"], { log: "data-start.log" });
  compose(["run", "--rm", "migrate"], { log: "migrate.log" });
  compose(["exec", "-T", "postgres", "oliginvest-pgbackrest", "stanza-create"], { log: "backup-init.log" });
  compose(["exec", "-T", "postgres", "oliginvest-pgbackrest", "--type=full", "backup"], { log: "backup.log" });
  compose(["exec", "-T", "postgres", "oliginvest-pgbackrest", "check"], { log: "backup-check.log" });
  compose(["up", "-d", "--wait", "--wait-timeout", "120"], { log: "application-start.log" });
  // Production Caddy syntax is validated separately; test uses an ephemeral local CA.
  compose(["run", "--rm", "--no-deps", "-v", `${resolve(root, "infra/caddy/Caddyfile")}:/tmp/production.Caddyfile:ro`, "caddy", "caddy", "adapt", "--validate", "--config", "/tmp/production.Caddyfile", "--adapter", "caddyfile"], { log: "caddy-validate.log" });
  for (const service of ["web", "analytics"]) {
    const id = compose(["ps", "-q", service]);
    const container = JSON.parse(docker(["inspect", id]))[0];
    for (const network of Object.keys(container.NetworkSettings.Networks)) assert.equal(docker(["network", "inspect", network, "--format", "{{.Internal}}"]), "true");
  }
  const query = "import os,psycopg; c=psycopg.connect(host='postgres',dbname='oliginvest',user='oliginvest_analytics_ro',password=open(os.environ['DB_ANALYTICS_RO_PASSWORD_FILE']).read());\ntry:\n c.execute('SELECT * FROM portfolio.transactions LIMIT 1')\nexcept psycopg.errors.InsufficientPrivilege:\n print('PASS: analytics denied user data')\nelse:\n raise RuntimeError('Analytics read user data')";
  compose(["exec", "-T", "analytics", "python", "-c", query], { log: "analytics-isolation.log" });
  const env = { ...environment, E2E_BASE_URL: `https://localhost:${port}`, E2E_API_URL: `https://localhost:${port}` };
  run(process.execPath, ["apps/web/node_modules/@playwright/test/cli.js", "test", "--config=apps/web/playwright.config.ts"], { env, log: "e2e.log" });
  console.log("Production images, Compose, backup, isolation and three-browser E2E PASS");
} finally {
  if (readFileSafe(testPath)) {
    try { compose(["logs", "--no-color", "--tail=50"], { log: "services.log" }); } catch { /* Preserve original failure. */ }
    compose(["down", "--volumes", "--remove-orphans"], { log: "cleanup.log" });
  }
  docker(["volume", "rm", state]);
}
function readFileSafe(path) {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}
