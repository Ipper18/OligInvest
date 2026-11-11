import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  BETA_RULES,
  CADDY_IMAGE,
  edgeCaddyfile,
  MINIMUM_URLS,
  parseRules,
  RULES_FILE,
  SCANS,
  summarize,
  urlTotal,
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
