import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  API_AUTH_FLOW,
  API_REQUESTS,
  API_SCANS,
  BETA_RULES,
  CADDY_IMAGE,
  cookieProblems,
  edgeCaddyfile,
  findLeaks,
  MINIMUM_URLS,
  parseRules,
  RULES_FILE,
  SCANS,
  scanStatus,
  summarize,
  urlTotal,
  verifyApiCoverage,
  verifyAuthFlow,
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

// BL-614b: synthetic rows in the shape the authenticated hook writes (names and attributes only).
const SESSION = "__Host-oliginvest.session_token";
const attributes = (extra) => [
  ["path", "/"],
  ["httponly", ""],
  ["secure", ""],
  ["samesite", "Lax"],
  ...extra,
];
const issued = (name, extra = [["max-age", "604800"]]) => ({
  name,
  empty: false,
  attributes: attributes(extra),
});
const deleted = (name, extra = [["max-age", "0"]]) => ({
  name,
  empty: true,
  attributes: attributes(extra),
});
const flowRows = () =>
  API_AUTH_FLOW.map((step) => ({
    method: step.method,
    path: step.path,
    status: step.status,
    code: step.code ?? null,
    noStore: true,
    sent: step.sends ?? [],
    cookies: [
      ...(step.issues ?? []).map((name) => issued(name)),
      ...(step.clears ?? []).map((name) => deleted(name)),
    ],
    captured: step.capture === "totp",
    mfaVerified: step.mfaVerified ?? null,
    twoFactorRedirect: step.twoFactorRedirect ?? null,
    session: step.session ?? null,
  }));
const at = (path, method = "POST") =>
  API_AUTH_FLOW.findIndex((step) => step.path === path && step.method === method);

it("plans registration, TOTP enrolment, sign-out, TOTP sign-in and protected reads", () => {
  expect(API_SCANS[0]).toEqual({
    name: "api-public",
    entry: "/api/v1/health/ready",
    authenticated: false,
  });
  expect(API_SCANS[1]).toMatchObject({ name: "api-authenticated", flow: true });
  const posts = API_AUTH_FLOW.filter(
    (step) => step.path.startsWith("/api/auth/") && step.method === "POST",
  );
  expect(posts.map((step) => step.path)).toEqual([
    "/api/auth/sign-up/email",
    "/api/auth/two-factor/enable",
    "/api/auth/two-factor/verify-totp",
    "/api/auth/sign-out",
    "/api/auth/sign-in/email",
    "/api/auth/two-factor/verify-totp",
  ]);
  // Enrolment uses the previous TOTP step and sign-in the current one: no replayed code.
  expect(posts.filter((step) => step.body.code).map((step) => step.body.code)).toEqual([
    "{{totp:previous}}",
    "{{totp:current}}",
  ]);
  // Credentials are placeholders filled in the container; nothing secret-looking is committed.
  expect(JSON.stringify(API_AUTH_FLOW)).not.toMatch(/[A-Za-z0-9_-]{24,}/u);
  expect(API_AUTH_FLOW.slice(at("/api/auth/sign-in/email")).length).toBeGreaterThan(10);
  // Every planned path is an operation of the reviewed OpenAPI document.
  const documented = new Set(
    [...read("../../../docs/02-api/openapi.yaml").matchAll(/^ {2}(\/[^:\s]+):$/gmu)].map(
      (match) => match[1],
    ),
  );
  for (const step of API_AUTH_FLOW)
    expect(documented.has(step.path.replace(/^\/api\/(v1|auth)/u, "")), step.path).toBe(true);
});

it("accepts the expected TOTP session flow and rejects every weakened variant", () => {
  expect(verifyAuthFlow(flowRows(), flowRows()).length).toBeGreaterThan(0);
  const change = (index, patch) => {
    const rows = flowRows();
    rows[index] = { ...rows[index], ...patch };
    return rows;
  };
  const enrol = at("/api/auth/two-factor/verify-totp");
  const signIn = at("/api/auth/sign-in/email");
  for (const rows of [
    flowRows().slice(0, -1),
    change(1, { status: 401, code: "UNAUTHENTICATED" }),
    change(2, { status: 200, code: null }),
    change(enrol, { mfaVerified: false }),
    change(enrol, { cookies: [] }),
    change(at("/api/auth/sign-out"), { cookies: [] }),
    change(at("/api/auth/get-session", "GET"), { session: "verified" }),
    change(signIn, { cookies: [issued(SESSION)] }),
    change(signIn, { twoFactorRedirect: null }),
    change(at("/api/auth/two-factor/enable"), { captured: false }),
    change(at("/api/v1/admin/invitations"), { status: 201, code: null }),
    change(0, { sent: [SESSION] }),
    change(3, { noStore: false }),
  ])
    expect(() => verifyAuthFlow(rows, flowRows())).toThrow();
  // Spider and other recorded exchanges are held to the same cookie contract.
  const loose = { cookies: [issued(SESSION, [["domain", "localhost"]])] };
  expect(() => verifyAuthFlow(flowRows(), [...flowRows(), loose])).toThrow(/domain/u);
  expect(() => verifyAuthFlow(flowRows(), null)).toThrow(/coverage/u);
});

it("enforces __Host-, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain and real expiry", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  expect(cookieProblems(issued(SESSION), now)).toEqual([]);
  expect(cookieProblems(deleted(SESSION), now)).toEqual([]);
  // The web relay deletion form (#81): Expires in the past, no Max-Age.
  const epoch = ["expires", "Thu, 01 Jan 1970 00:00:00 GMT"];
  expect(cookieProblems(deleted(SESSION, [epoch]), now)).toEqual([]);
  // Max-Age wins over Expires (RFC 6265 § 5.3), exactly as relay.ts reads it.
  const future = ["expires", "Fri, 01 Jan 2100 00:00:00 GMT"];
  expect(cookieProblems(deleted(SESSION, [["max-age", "0"], future]), now)).toEqual([]);
  const without = (key) => ({
    ...issued(SESSION),
    attributes: issued(SESSION).attributes.filter(([name]) => name !== key),
  });
  for (const key of ["secure", "httponly", "samesite", "path"])
    expect(cookieProblems(without(key), now)).toEqual([key]);
  for (const name of ["oliginvest.session_token", "__Secure-oliginvest.session_token"])
    expect(cookieProblems({ ...issued(SESSION), name }, now)).toEqual(["name"]);
  const extra = (pair) => issued(SESSION, [["max-age", "60"], pair]);
  expect(cookieProblems(extra(["domain", "example.test"]), now)).toEqual(["domain"]);
  expect(cookieProblems(extra(["secure", ""]), now)).toEqual(["secure"]);
  expect(cookieProblems(extra(["max-age", "60"]), now)).toEqual(["max-age"]);
  const replaced = (key, value) => ({
    ...issued(SESSION),
    attributes: issued(SESSION).attributes.map(([name, setting]) =>
      name === key ? [name, value] : [name, setting],
    ),
  });
  expect(cookieProblems(replaced("samesite", "None"), now)).toEqual(["samesite"]);
  expect(cookieProblems(replaced("samesite", "Strict"), now)).toEqual(["samesite"]);
  expect(cookieProblems(replaced("path", "/api"), now)).toEqual(["path"]);
  // An empty value must really expire; a value must not arrive already expired.
  expect(cookieProblems(deleted(SESSION, [["max-age", "60"]]), now)).toEqual(["deletion"]);
  expect(cookieProblems(deleted(SESSION, []), now)).toEqual(["deletion"]);
  expect(cookieProblems(deleted(SESSION, [future]), now)).toEqual(["deletion"]);
  expect(cookieProblems(issued(SESSION, [["max-age", "0"]]), now)).toEqual(["expired"]);
  expect(cookieProblems(issued(SESSION, [epoch]), now)).toEqual(["expired"]);
  expect(cookieProblems(issued(SESSION, [["max-age", "soon"]]), now)).toContain("max-age");
});

it("finds handled secrets in scan artefacts by kind, raw or URL-encoded, never echoing them", () => {
  const sensitive = [
    { kind: "TOTP secret", value: "SYNTHETICBASE32VALUEFORTEST" },
    { kind: "cookie value", value: "synthetic.value+with/sig=" },
    { kind: "backup code", value: "short" },
  ];
  expect(findLeaks([["report.html", "nothing here"]], sensitive)).toEqual([]);
  const leaks = findLeaks(
    [
      ["report.json", "evidence SYNTHETICBASE32VALUEFORTEST"],
      ["zap.log", `cookie ${encodeURIComponent("synthetic.value+with/sig=")}`],
      ["report.md", "short"],
    ],
    sensitive,
  );
  expect(leaks).toEqual(["TOTP secret in report.json", "cookie value in zap.log"]);
  expect(leaks.join(" ")).not.toContain("SYNTHETIC");
});
