import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  API_REQUESTS,
  BETA_RULES,
  CADDY_IMAGE,
  edgeCaddyfile,
  MINIMUM_URLS,
  parseRules,
  RULES_FILE,
  SCANS,
  scanStatus,
  summarize,
  urlTotal,
  verifyApiCoverage,
  ZAP_IMAGE,
} from "../scripts/zap-baseline.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const caddyTest = read("../../../infra/caddy/Caddyfile.test");
const upstreams = { port: 4443, web: "127.0.0.1:3001", api: "127.0.0.1:3002" };

it("scans the real Caddyfile.test edge with only port, upstreams and SNI substituted", () => {
  const derived = edgeCaddyfile(caddyTest, upstreams);
  expect(derived).toContain("https://localhost:4443 {");
  expect(derived).toContain(" reverse_proxy /api/* 127.0.0.1:3002 {");
  expect(derived).toContain(" reverse_proxy 127.0.0.1:3001 {");
  expect(derived).toContain(" default_sni localhost");
  expect(derived).not.toMatch(/\b(api|web):3000\b/u);
  const headers = (text) => /\n header \{\n([\s\S]*?)\n \}\n/u.exec(text)?.[1];
  expect(headers(derived)).toBe(headers(caddyTest));
  expect(headers(derived)).toContain("Cross-Origin-Embedder-Policy require-corp");
});

it("rejects an API scan that misses a route, reaches only errors or carries cookies", () => {
  const covered = API_REQUESTS.map(({ method, path, status, code }) => ({
    method,
    path,
    status,
    code: code ?? null,
    cookies: 0,
    authenticated: false,
    noStore: true,
    sessionNull: path === "/api/auth/get-session",
    ready: path === "/api/v1/health/ready",
  }));
  expect(() => verifyApiCoverage(covered)).not.toThrow();
  expect(() => verifyApiCoverage(covered.slice(1))).toThrow(/coverage/u);
  const replace = (path, change) =>
    covered.map((row) => (row.path === path ? { ...row, ...change } : row));
  for (const change of [
    { status: 404 },
    { method: "POST" },
    { cookies: 1 },
    { authenticated: true },
    { noStore: false },
    { ready: false },
  ])
    expect(() => verifyApiCoverage(replace("/api/v1/health/ready", change))).toThrow();
  expect(() =>
    verifyApiCoverage(replace("/api/auth/get-session", { sessionNull: false })),
  ).toThrow();
  expect(() => verifyApiCoverage(replace("/api/v1/me", { code: "INTERNAL" }))).toThrow();
  expect(() =>
    verifyApiCoverage([...covered, { ...covered[0], path: "/unexpected", cookies: 1 }]),
  ).toThrow();
});

it("keeps every registered auth facade route in the anonymous scan plan", () => {
  const routes = read("../../api/src/auth/routes.ts");
  const registered = [...routes.matchAll(/\[\s*"(\/[^"\s]+)",\s*"auth[A-Z]/gu)]
    .map((match) => `/api/auth${match[1]}`)
    .toSorted();
  expect(registered.length).toBeGreaterThan(0);
  expect(
    API_REQUESTS.filter((item) => item.path.startsWith("/api/auth/"))
      .map((item) => item.path)
      .toSorted(),
  ).toEqual(registered);
});

it("fails loudly when Caddyfile.test drifts", () => {
  for (const drift of [
    caddyTest.replace(" reverse_proxy web:3000 {", " reverse_proxy app:3000 {"),
    caddyTest.replace("https://localhost {", "https://invest.localhost {"),
    `${caddyTest}\nhttps://localhost {\n}\n`,
  ])
    expect(() => edgeCaddyfile(drift, upstreams)).toThrow(/Caddyfile.test drift/u);
});

it("keeps the rules file explicit: reasons everywhere, no IGNORE without an owner decision", () => {
  const rules = parseRules(readFileSync(RULES_FILE, "utf8"));
  expect([...rules.values()].filter((level) => level === "IGNORE")).toEqual([]);
  for (const id of ["10020", "10021", "10035", "10038", "10055", "10063", "90004"])
    expect(rules.get(id)).toBe("FAIL");
  for (const line of [
    "*\tIGNORE\t(All)\tblanket suppression is not allowed",
    "10202\tIGNORE\t(Absence of Anti-CSRF Tokens)",
    "10202\tIGNORE\t(Absence of Anti-CSRF Tokens)\tshort",
    "10202\tOUTOFSCOPE\t.*/api/.*",
    "10202\tWARN\tno parentheses around the name\tsome reason text",
    "10202\tWARN\t(A)\tfirst entry reason\n10202\tFAIL\t(A)\tsecond entry reason",
  ])
    expect(() => parseRules(line)).toThrow();
});

it("summarizes the traditional JSON report by risk and reads the URL total", () => {
  const rows = summarize({
    site: [
      {
        alerts: [
          {
            pluginid: "10015",
            name: "Info",
            riskdesc: "Informational (Low)",
            count: "1",
            instances: [],
          },
          {
            pluginid: "10202",
            name: "CSRF",
            riskdesc: "Medium (Low)",
            count: "2",
            instances: [{ uri: "https://localhost:1/a?x=1" }, { uri: "https://localhost:1/a" }],
          },
        ],
      },
    ],
  });
  expect(rows.map((row) => row.id)).toEqual(["10202", "10015"]);
  expect(rows[0]).toMatchObject({ count: 2, urls: ["/a"] });
  expect(urlTotal("Using the Automation Framework\nTotal of 153 URLs\nPASS: x")).toBe(153);
  expect(urlTotal("Automation plan failures")).toBe(0);
});

it("enforces rule levels even when legacy baseline ignores informational alerts", () => {
  const findings = [{ id: "10019", risk: "Informational (Medium)" }];
  expect(scanStatus(0, findings, new Map([["10019", "FAIL"]]))).toBe(1);
  expect(scanStatus(0, findings, new Map())).toBe(2);
  expect(scanStatus(1, [], new Map())).toBe(1);
  expect(scanStatus(2, [], new Map())).toBe(2);
  expect(scanStatus(0, [], new Map())).toBe(0);
  for (const code of [3, 125, null]) expect(() => scanStatus(code, [], new Map())).toThrow();
});

it("pins every downloaded artifact and guards against vacuous scans", () => {
  expect(ZAP_IMAGE).toMatch(/^zaproxy\/zap-stable:2\.17\.0@sha256:[0-9a-f]{64}$/u);
  expect(read("../../../infra/docker/caddy.Dockerfile")).toContain(`FROM ${CADDY_IMAGE}\n`);
  expect(BETA_RULES.sha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(BETA_RULES.url).toMatch(
    /^https:\/\/github\.com\/zaproxy\/zap-extensions\/releases\/download\/pscanrulesBeta-v\d+\//u,
  );
  expect(SCANS.map((scan) => scan.name)).toEqual(Object.keys(MINIMUM_URLS));
  expect(SCANS).toEqual([
    { name: "public", entry: "/logowanie", authenticated: false },
    { name: "authenticated", entry: "/portfel", authenticated: true },
  ]);
});
