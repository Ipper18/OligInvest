// BL-602: passive ZAP baseline against the local production build (NFR-03.06, NFR-03.07).
// Topology: ZAP → Caddy (infra/caddy/Caddyfile.test, upstreams substituted) → `next start`
// and the synthetic UI fixture API from performance-server. Passive only: no active scan,
// no add-on updates (`-silent`), no external targets.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fixtureCookie, isMain, report, withPerformanceServer } from "./performance-server.mjs";

// Published 2026-11-03T12:34:20Z (ZAP 2.17.0, weekly rebuild 20261103); see SEC § 9.1.
export const ZAP_IMAGE =
  "zaproxy/zap-stable:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af";
// Same Caddy 2.11.7 base digest as infra/docker/caddy.Dockerfile (reviewed there).
export const CADDY_IMAGE =
  "caddy:2.11.7@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772";
// `-silent` stops the baseline's unpinned `-addonupdate -addoninstall pscanrulesBeta`; the beta
// passive rules (Permissions-Policy 10063, site isolation 90004, …) are added from this exact
// release instead (published 2026-04-14T16:24:42Z; requires commonlib ≥ 1.40, image has 1.44).
export const BETA_RULES = {
  name: "pscanrulesBeta-beta-50.zap",
  url: "https://github.com/zaproxy/zap-extensions/releases/download/pscanrulesBeta-v50/pscanrulesBeta-beta-50.zap",
  sha256: "a979f7cd5d8be10e0338b417e006ec1e2f6ec79101010d570ddb5199892e921b",
};
// Guards against a vacuous scan (e.g. the auth header stops working); observed 30 and 153.
export const MINIMUM_URLS = { public: 15, authenticated: 80 };
const root = fileURLToPath(new URL("../../../", import.meta.url));
export const RULES_FILE = fileURLToPath(new URL("../zap-baseline.conf", import.meta.url));

async function betaRules(directory) {
  const path = resolve(directory, BETA_RULES.name);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    const response = await fetch(BETA_RULES.url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Add-on download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== BETA_RULES.sha256)
    throw new Error(`${BETA_RULES.name}: SHA-256 mismatch`);
  writeFileSync(path, bytes);
  return path;
}

export function urlTotal(log) {
  return Number(/^Total of (\d+) URLs$/mu.exec(log)?.[1] ?? 0);
}

// Every substitution must match exactly once, so drift in Caddyfile.test fails loudly.
// Java (ZAP) sends no SNI for the single-label host `localhost`, hence `default_sni`.
export function edgeCaddyfile(source, { port, web, api }) {
  const replacements = [
    [
      /^( *)auto_https disable_redirects$/mu,
      "$1auto_https disable_redirects\n$1default_sni localhost",
    ],
    [/^https:\/\/localhost \{$/mu, `https://localhost:${port} {`],
    [/^( *reverse_proxy \/api\/\* )api:3000( \{)$/mu, `$1${api}$2`],
    [/^( *reverse_proxy )web:3000( \{)$/mu, `$1${web}$2`],
  ];
  let text = source;
  for (const [pattern, value] of replacements) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    const count = text.match(global)?.length ?? 0;
    if (count !== 1) throw new Error(`Caddyfile.test drift: ${pattern} matched ${count} times`);
    text = text.replace(pattern, value);
  }
  return text;
}

// Rules file: `<id>\t<FAIL|WARN|INFO|IGNORE>\t(<name>)\t<reason>` — the layout ZAP's
// load_config reads (4th column = message on the alert). Every entry carries a reason; no
// wildcard ids and no OUTOFSCOPE, so nothing is suppressed in bulk.
export function parseRules(text) {
  const rules = new Map();
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const [id = "", action = "", name = "", reason = "", ...extra] = line.split("\t");
    const where = `Rule line ${index + 1}`;
    if (!/^\d+$/u.test(id)) throw new Error(`${where}: invalid id ${id}`);
    if (!["FAIL", "WARN", "INFO", "IGNORE"].includes(action))
      throw new Error(`${where}: unsupported action ${action}`);
    if (!/^\(.+\)$/u.test(name) || reason.trim().length < 10 || extra.length)
      throw new Error(`${where}: expected (<rule name>) and a written reason`);
    if (rules.has(id)) throw new Error(`Rule ${id}: duplicate entry`);
    rules.set(id, action);
  }
  return rules;
}

// Traditional JSON report → one row per rule, highest risk first.
export function summarize(json) {
  const rows = [];
  for (const site of json.site ?? [])
    for (const alert of site.alerts ?? [])
      rows.push({
        id: alert.pluginid,
        name: alert.name ?? alert.alert,
        risk: alert.riskdesc,
        count: Number(alert.count ?? alert.instances?.length ?? 0),
        urls: [...new Set((alert.instances ?? []).map((i) => new URL(i.uri).pathname))].slice(0, 3),
      });
  const order = ["High", "Medium", "Low", "Informational"];
  return rows.sort(
    (a, b) =>
      order.indexOf(a.risk.split(" ")[0]) - order.indexOf(b.risk.split(" ")[0]) ||
      Number(a.id) - Number(b.id),
  );
}

// Asynchronous on purpose: the synthetic fixture API runs on this process's event loop.
function docker(args, timeout = 600000) {
  return new Promise((accept, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      accept({ status, stdout, stderr });
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  const { port } = server.address();
  await new Promise((accept) => server.close(accept));
  return port;
}

// Readiness probe of the loopback-only edge, verified against Caddy's ephemeral local root CA.
function probe(url, ca) {
  return new Promise((accept) => {
    const options = { ca, servername: "localhost", timeout: 2000 };
    const call = request(url, options, (response) => {
      response.resume();
      accept(response.statusCode ?? 0);
    });
    call.on("timeout", () => call.destroy());
    call.on("error", () => accept(0));
    call.end();
  });
}

// The authenticated scan sends the synthetic fixture session for its entry route (never real).
export const SCANS = [
  { name: "public", entry: "/logowanie", authenticated: false },
  { name: "authenticated", entry: "/portfel", authenticated: true },
];

async function main() {
  if (process.env.BASE_URL) throw new Error("ZAP baseline scans only the local instance");
  const linux = process.platform === "linux";
  const gitPath = (name) =>
    resolve(
      root,
      execFileSync("git", ["rev-parse", "--git-path", name], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    );
  const output = gitPath("zap-baseline");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const cache = gitPath("zap-addons");
  mkdirSync(cache, { recursive: true });
  const addOn = await betaRules(cache);
  const rules = parseRules(readFileSync(RULES_FILE, "utf8"));
  const started = Date.now();
  const results = await withPerformanceServer(
    async (upstream) => {
      const port = await freePort();
      const host = linux ? "127.0.0.1" : "host.docker.internal";
      const caddyfile = resolve(output, "Caddyfile");
      writeFileSync(
        caddyfile,
        edgeCaddyfile(readFileSync(resolve(root, "infra/caddy/Caddyfile.test"), "utf8"), {
          port,
          web: `${host}:${new URL(upstream.web).port}`,
          api: `${host}:${new URL(upstream.api).port}`,
        }),
      );
      const edge = `oliginvest-zap-edge-${randomBytes(4).toString("hex")}`;
      const network = linux ? ["--network", "host"] : ["-p", `127.0.0.1:${port}:${port}`];
      const startedEdge = await docker([
        "run",
        "-d",
        "--rm",
        "--name",
        edge,
        ...network,
        "--mount",
        `type=bind,source=${caddyfile},target=/etc/caddy/Caddyfile,readonly`,
        CADDY_IMAGE,
      ]);
      if (startedEdge.status !== 0) throw new Error(`Caddy edge failed: ${startedEdge.stderr}`);
      try {
        const origin = `https://localhost:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 60 && !ready; attempt++) {
          const ca = (
            await docker(["exec", edge, "cat", "/data/caddy/pki/authorities/local/root.crt"])
          ).stdout;
          ready = Boolean(ca) && (await probe(`https://127.0.0.1:${port}/logowanie`, ca)) === 200;
          if (!ready) await delay(500);
        }
        if (!ready) throw new Error("Caddy edge is not ready");
        const rows = [];
        for (const scan of SCANS) {
          const directory = resolve(output, scan.name);
          mkdirSync(directory, { recursive: true });
          copyFileSync(RULES_FILE, resolve(directory, "rules.conf"));
          // The container user (zap, uid 1000) writes reports into the bind mount.
          chmodSync(directory, 0o777);
          const cookie = scan.authenticated ? fixtureCookie(scan.entry) : "";
          if (scan.authenticated && !cookie.startsWith("__Host-oliginvest.session_token=fixture-"))
            throw new Error("Authenticated scan requires the synthetic fixture session");
          const auth = cookie
            ? [
                "-e",
                "ZAP_AUTH_HEADER=Cookie",
                "-e",
                `ZAP_AUTH_HEADER_VALUE=${cookie}`,
                "-e",
                "ZAP_AUTH_HEADER_SITE=localhost",
              ]
            : [];
          const begin = Date.now();
          const zap = await docker([
            "run",
            "--rm",
            "--network",
            `container:${edge}`,
            "--mount",
            `type=bind,source=${directory},target=/zap/wrk`,
            "--mount",
            `type=bind,source=${addOn},target=/zap/plugin/${BETA_RULES.name},readonly`,
            ...auth,
            ZAP_IMAGE,
            "zap-baseline.py",
            "-t",
            `${origin}${scan.entry}`,
            "-c",
            "rules.conf",
            "-J",
            "report.json",
            "-r",
            "report.html",
            "-w",
            "report.md",
            "-m",
            "1",
            "-T",
            "5",
            "-z",
            "-silent",
          ]);
          writeFileSync(resolve(directory, "zap.log"), zap.stdout + zap.stderr);
          const seconds = Math.round((Date.now() - begin) / 1000);
          if (zap.status === 3 || zap.status === null)
            throw new Error(`ZAP ${scan.name} scan error; inspect ${directory}/zap.log`);
          const urls = urlTotal(zap.stdout);
          if (urls < MINIMUM_URLS[scan.name])
            throw new Error(
              `ZAP ${scan.name} scan reached only ${urls} URLs; inspect ${directory}`,
            );
          const findings = summarize(JSON.parse(readFileSync(resolve(directory, "report.json"))));
          rows.push({ scan: scan.name, status: zap.status, seconds, urls, findings });
        }
        return rows;
      } finally {
        await docker(["rm", "-f", edge]);
      }
    },
    { edge: false },
  );
  const lines = [
    `## ZAP baseline (BL-602) — ${Math.round((Date.now() - started) / 1000)} s`,
    "",
    "| Scan | Exit | Time | URLs | Rule | Level | Risk | Instances | Example paths |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of results) {
    if (!row.findings.length)
      lines.push(
        `| ${row.scan} | ${row.status} | ${row.seconds} s | ${row.urls} | — | — | — | 0 | — |`,
      );
    for (const finding of row.findings)
      lines.push(
        `| ${row.scan} | ${row.status} | ${row.seconds} s | ${row.urls} | ${finding.id} ${finding.name} | ${rules.get(finding.id) ?? "WARN"} | ${finding.risk} | ${finding.count} | ${finding.urls.join(", ")} |`,
      );
  }
  report(lines.join("\n"));
  // Exit 1 = a FAIL rule matched; WARN (2) is reported for the owner's decision (SEC § 9.1).
  if (results.some((row) => row.status === 1)) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
