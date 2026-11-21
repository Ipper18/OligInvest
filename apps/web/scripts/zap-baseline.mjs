// BL-602: passive ZAP baseline against the local production build (NFR-03.06, NFR-03.07).
// Topology: ZAP → Caddy (infra/caddy/Caddyfile.test, upstreams substituted) → `next start`
// and the synthetic UI fixture API from performance-server. Passive only: no active scan,
// no add-on updates (`-silent`), no external targets.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

// BL-614: deliberate anonymous traffic, including POSTs a spider cannot discover from JSON.
// Invalid registration/reset bodies stop before password checks; no account or session is created.
export const API_REQUESTS = [
  { method: "GET", path: "/api/v1/health/live", status: 200 },
  { method: "GET", path: "/api/v1/health/ready", status: 200 },
  { method: "GET", path: "/api/v1/openapi.json", status: 200 },
  { method: "GET", path: "/api/v1", status: 404, code: "NOT_FOUND" },
  { method: "GET", path: "/api/health/live", status: 404, code: "NOT_FOUND" },
  { method: "GET", path: "/api/health/ready", status: 404, code: "NOT_FOUND" },
  { method: "GET", path: "/api/v1/me", status: 401, code: "UNAUTHENTICATED" },
  { method: "GET", path: "/api/auth/get-session", status: 200 },
  { method: "GET", path: "/api/auth/list-sessions", status: 401, code: "UNAUTHENTICATED" },
  ...[
    "sign-up/email",
    "reset-password",
    "change-password",
    "two-factor/enable",
    "two-factor/generate-backup-codes",
    "revoke-session",
  ].map((path) => ({
    method: "POST",
    path: `/api/auth/${path}`,
    body: {},
    status: 400,
    code: "BAD_REQUEST",
  })),
  ...["sign-out", "revoke-other-sessions"].map((path) => ({
    method: "POST",
    path: `/api/auth/${path}`,
    body: {},
    status: 401,
    code: "UNAUTHENTICATED",
  })),
  {
    method: "POST",
    path: "/api/auth/sign-in/email",
    status: 401,
    code: "UNAUTHENTICATED",
    body: { email: "zap-absent@example.test", password: "invalid-synthetic-password" },
  },
  {
    method: "POST",
    path: "/api/auth/request-password-reset",
    status: 200,
    body: { email: "zap-absent@example.test" },
  },
  {
    method: "POST",
    path: "/api/auth/two-factor/verify-totp",
    status: 401,
    code: "UNAUTHENTICATED",
    body: { code: "000000" },
  },
  {
    method: "POST",
    path: "/api/auth/two-factor/verify-backup-code",
    status: 401,
    code: "UNAUTHENTICATED",
    body: { code: "invalid-code" },
  },
];

export function verifyApiCoverage(rows) {
  if (!Array.isArray(rows)) throw new Error("API coverage is missing");
  for (const row of rows) {
    if (row.cookies !== 0 || row.authenticated !== false)
      throw new Error(`Anonymous API scan used authentication or received Set-Cookie: ${row.path}`);
  }
  for (const expected of API_REQUESTS) {
    const matches = rows.filter(
      (row) => row.method === expected.method && row.path === expected.path,
    );
    if (!matches.length)
      throw new Error(`Missing API coverage: ${expected.method} ${expected.path}`);
    for (const row of matches) {
      if (row.status !== expected.status || row.code !== (expected.code ?? null) || !row.noStore)
        throw new Error(
          `Unexpected API response: ${expected.method} ${expected.path} (${row.status}, ${row.code})`,
        );
      if (row.path === "/api/v1/health/ready" && !row.ready)
        throw new Error("API database/Valkey dependencies are not ready");
      if (row.path === "/api/auth/get-session" && !row.sessionNull)
        throw new Error("API scan unexpectedly has a session");
    }
  }
}

// BL-614b: authenticated pass over the same production API. The hook registers a synthetic
// invited account, enrols TOTP, signs out, signs in again with TOTP and then reads protected
// routes, all through ZAP so the passive cookie rules (10010, 10011, 10054, 90033) see every
// Set-Cookie. `{{…}}` placeholders are filled inside the container from the per-run account
// file and the TOTP secret returned by enrolment; values never reach reports or logs.
// `sends`: cookie names on the request; `issues`/`clears`: Set-Cookie names expected back.
const SESSION = "__Host-oliginvest.session_token";
const TWO_FACTOR = "__Host-oliginvest.two_factor";
const SESSION_DATA = "__Host-oliginvest.session_data";
const DONT_REMEMBER = "__Host-oliginvest.dont_remember";
const LEGAL = { acceptTerms: true, termsVersion: "2026-09", privacyNoticeVersion: "2026-09" };
const signedIn = (path, extra = {}) => ({
  method: "GET",
  path,
  status: 200,
  sends: [SESSION],
  ...extra,
});
export const API_AUTH_FLOW = [
  {
    method: "POST",
    path: "/api/auth/sign-up/email",
    body: {
      name: "ZAP synthetic",
      email: "{{email}}",
      password: "{{password}}",
      invitationToken: "{{invitationToken}}",
      ...LEGAL,
    },
    status: 200,
    issues: [SESSION],
    mfaVerified: false,
  },
  signedIn("/api/v1/me"),
  signedIn("/api/v1/portfolio/summary", { status: 403, code: "MFA_ENROLLMENT_REQUIRED" }),
  {
    method: "POST",
    path: "/api/auth/two-factor/enable",
    body: { password: "{{password}}" },
    status: 200,
    sends: [SESSION],
    capture: "totp",
  },
  {
    method: "POST",
    path: "/api/auth/two-factor/verify-totp",
    body: { code: "{{totp:previous}}" },
    status: 200,
    sends: [SESSION],
    issues: [SESSION],
    mfaVerified: true,
  },
  {
    method: "POST",
    path: "/api/auth/sign-out",
    body: {},
    status: 200,
    sends: [SESSION],
    clears: [SESSION, SESSION_DATA, DONT_REMEMBER],
  },
  // The pre-sign-out cookie must be dead server-side, not only deleted in the browser.
  {
    method: "GET",
    path: "/api/auth/get-session",
    status: 200,
    sends: [SESSION],
    cookies: "stale",
    session: "none",
  },
  {
    method: "POST",
    path: "/api/auth/sign-in/email",
    body: { email: "{{email}}", password: "{{password}}" },
    status: 200,
    // Password alone yields only the short-lived challenge cookie, never a session.
    issues: [TWO_FACTOR],
    clears: [SESSION, SESSION_DATA],
    twoFactorRedirect: true,
  },
  {
    method: "POST",
    path: "/api/auth/two-factor/verify-totp",
    body: { code: "{{totp:current}}" },
    status: 200,
    sends: [TWO_FACTOR],
    issues: [SESSION],
    clears: [TWO_FACTOR],
    mfaVerified: true,
  },
  signedIn("/api/auth/get-session", { session: "verified" }),
  signedIn("/api/auth/list-sessions"),
  ...[
    "/api/v1/me",
    "/api/v1/me/preferences",
    "/api/v1/me/legal",
    "/api/v1/me/tokens",
    "/api/v1/notifications/preferences",
    "/api/v1/notifications/push-subscriptions",
    "/api/v1/market/status",
    "/api/v1/market/watchlists",
    "/api/v1/portfolio/accounts",
    "/api/v1/portfolio/transactions",
    "/api/v1/portfolio/summary",
    "/api/v1/portfolio/positions",
    "/api/v1/portfolio/cash",
    "/api/v1/portfolio/dividends",
  ].map((path) => signedIn(path)),
  // Authorization still applies to a fully verified `user` session.
  {
    method: "POST",
    path: "/api/v1/admin/invitations",
    body: { email: "zap-denied@scan.example.test", role: "user" },
    status: 403,
    code: "FORBIDDEN",
    sends: [SESSION],
  },
];

const attribute = (cookie, key) => cookie.attributes.filter(([name]) => name === key);

// Better Auth cookie contract (AUTH § 4.1, SEC § 3.6 and § 8 O-01): `__Host-` prefix, Secure,
// HttpOnly, SameSite=Lax, Path=/ and no Domain on every Set-Cookie, issued or deleted. A
// deletion is an empty value that expires now or earlier, judged as browsers and
// apps/web/src/auth/relay.ts do (Max-Age wins over Expires, RFC 6265 § 5.3).
export function cookieProblems(cookie, now = Date.now()) {
  const problems = [];
  if (!/^__Host-oliginvest\.[a-z_]+$/u.test(cookie.name)) problems.push("name");
  for (const flag of ["secure", "httponly"])
    if (attribute(cookie, flag).length !== 1) problems.push(flag);
  const single = (key) => {
    const values = attribute(cookie, key);
    return values.length === 1 ? values[0][1] : undefined;
  };
  if (single("samesite")?.toLowerCase() !== "lax") problems.push("samesite");
  if (single("path") !== "/") problems.push("path");
  if (attribute(cookie, "domain").length) problems.push("domain");
  for (const key of ["max-age", "expires"])
    if (attribute(cookie, key).length > 1) problems.push(key);
  const maxAge = single("max-age");
  const expires = single("expires");
  if (maxAge !== undefined && !/^-?\d+$/u.test(maxAge)) problems.push("max-age");
  if (expires !== undefined && Number.isNaN(Date.parse(expires))) problems.push("expires");
  const expired =
    maxAge !== undefined
      ? Number(maxAge) <= 0
      : expires !== undefined && Date.parse(expires) <= now;
  if (cookie.empty !== expired) problems.push(cookie.empty ? "deletion" : "expired");
  return problems;
}

export function verifyAuthFlow(flow, coverage, now = Date.now()) {
  if (!Array.isArray(flow) || flow.length > API_AUTH_FLOW.length)
    throw new Error("Authenticated API flow result is malformed");
  for (const [index, expected] of API_AUTH_FLOW.entries()) {
    const row = flow[index];
    const label = `${expected.method} ${expected.path} (step ${index + 1})`;
    if (!row) throw new Error(`Authenticated API flow stopped before ${label}`);
    if (
      row.method !== expected.method ||
      row.path !== expected.path ||
      row.status !== expected.status ||
      row.code !== (expected.code ?? null) ||
      !row.noStore
    )
      throw new Error(
        `Unexpected authenticated API response: ${label} (${row.status}, ${row.code})`,
      );
    const names = (list) => [...new Set(list)].toSorted().join(",");
    const issued = row.cookies.filter((cookie) => !cookie.empty).map((cookie) => cookie.name);
    const cleared = row.cookies.filter((cookie) => cookie.empty).map((cookie) => cookie.name);
    if (
      names(row.sent) !== names(expected.sends ?? []) ||
      names(issued) !== names(expected.issues ?? []) ||
      names(cleared) !== names(expected.clears ?? [])
    )
      throw new Error(
        `Unexpected cookies: ${label} (sent ${row.sent}; issued ${issued}; cleared ${cleared})`,
      );
    if ("mfaVerified" in expected && row.mfaVerified !== expected.mfaVerified)
      throw new Error(`Unexpected MFA state: ${label}`);
    if (expected.session && row.session !== expected.session)
      throw new Error(`Unexpected session state: ${label} (${row.session})`);
    if (expected.twoFactorRedirect && row.twoFactorRedirect !== true)
      throw new Error(`Missing TOTP challenge: ${label}`);
    if (expected.capture === "totp" && row.captured !== true)
      throw new Error(`TOTP enrolment returned no otpauth URI: ${label}`);
  }
  if (!Array.isArray(coverage)) throw new Error("API coverage is missing");
  const cookies = [...flow, ...coverage].flatMap((row) => row.cookies ?? []);
  if (!cookies.some((cookie) => cookie.name === SESSION && !cookie.empty))
    throw new Error("No session cookie was issued");
  for (const cookie of cookies) {
    const problems = cookieProblems(cookie, now);
    if (problems.length) throw new Error(`Cookie ${cookie.name} violates: ${problems.join(", ")}`);
  }
  // ZAP history already contains the flow exchanges; return each Set-Cookie once for the report.
  return coverage.flatMap((row) => row.cookies ?? []);
}

// Values the authenticated hook handled (password, invitation token, TOTP secret, backup codes,
// cookie values) must not appear in any artefact uploaded from the scan directory.
export function findLeaks(files, sensitive) {
  const leaks = [];
  for (const [file, text] of files)
    for (const { kind, value } of sensitive)
      if (
        typeof value === "string" &&
        value.length >= 8 &&
        [value, encodeURIComponent(value)].some((form) => text.includes(form))
      )
        leaks.push(`${kind} in ${file}`);
  return [...new Set(leaks)];
}

// Official baseline hooks: seed requests before the passive queue drains, then attest ALL
// recorded exchanges (including spider traffic). No cookie jar, auth header, rule or threshold changes.
const API_HOOK = `import json
from pathlib import Path
from urllib.parse import urlsplit

def zap_started(zap, target):
    url = urlsplit(target)
    origin = url.scheme + "://" + url.netloc
    for item in json.loads(Path("/zap/wrk/requests.json").read_text()):
        body = json.dumps(item["body"]) if "body" in item else ""
        headers = [item["method"] + " " + origin + item["path"] + " HTTP/1.1",
                   "Host: " + url.netloc, "Accept: application/json"]
        if body:
            headers += ["Origin: " + origin, "Content-Type: application/json",
                        "Content-Length: " + str(len(body.encode()))]
        zap.core.send_request("\\r\\n".join(headers) + "\\r\\n\\r\\n" + body, followredirects=False)

def zap_pre_shutdown(zap):
    rows = []
    start = 0
    while True:
        messages = zap.core.messages(start=start, count=100)
        if not messages:
            break
        start += len(messages)
        for message in messages:
            request = message["requestHeader"].splitlines()
            method, url, _ = request[0].split(" ", 2)
            headers = message["responseHeader"].splitlines()
            # ZAP creates status-0 site-tree placeholders for unrequested parent paths.
            # They are not HTTP exchanges and must never satisfy route coverage.
            if headers[0].split()[1] == "0":
                continue
            try:
                body = json.loads(message.get("responseBody") or "")
            except (ValueError, KeyError):
                body = None
            checks = body.get("checks", {}) if isinstance(body, dict) else {}
            rows.append({
                "method": method, "path": urlsplit(url).path,
                "status": int(headers[0].split()[1]),
                "code": body.get("code") if isinstance(body, dict) else None,
                "cookies": sum(h.lower().startswith("set-cookie:") for h in headers[1:]),
                "authenticated": any(h.lower().startswith(("cookie:", "authorization:")) for h in request[1:]),
                "noStore": any(h.lower().startswith("cache-control:") and "no-store" in h.lower() for h in headers[1:]),
                # The ZAP JSON API serializes the literal four-byte body "null" as JSON null.
                # An absent/empty body must not satisfy this assertion.
                "sessionNull": message.get("responseBody") == "null" or
                    ("responseBody" in message and message["responseBody"] is None and
                     any(h.lower() == "content-length: 4" for h in headers[1:])),
                "ready": isinstance(body, dict) and body.get("status") == "ok" and
                    all(checks.get(k) == "ok" for k in ("postgres", "valkeyQueue", "valkeyCache")),
            })
    Path("/zap/wrk/coverage.json").write_text(json.dumps(rows, indent=2))
`;

// BL-614b hook. Same ZAP API calls as above plus a manual cookie jar for the explicit flow only;
// ZAP's own HTTP state, auth headers, rules and thresholds stay untouched. Sensitive values go
// to /zap/secret (a separate, deleted-after-run mount), never to /zap/wrk, stdout or reports.
// Cookie rows keep names and attributes only, never values.
const AUTH_HOOK = `import base64, hashlib, hmac, json, struct, time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

SECRET = Path("/zap/secret")
sensitive = []

def keep(kind, value):
    # Rewritten on every value, so even an aborted flow leaves a complete list to scan for.
    if isinstance(value, str) and value:
        sensitive.append({"kind": kind, "value": value})
        (SECRET / "sensitive.json").write_text(json.dumps(sensitive))

def totp(secret, step):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[19] & 15
    return "%06d" % ((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000)

def code(secret, which):
    # Not a retry: never compute a code in the last 5 s of its 30 s step, so it cannot expire
    # in flight. Enrolment uses the previous step, sign-in the current one (no replay).
    while 30 - time.time() % 30 < 5:
        time.sleep(0.5)
    step = int(time.time() // 30)
    return totp(secret, step - 1 if which == "previous" else step)

def cookies(headers):
    rows = []
    for line in headers[1:]:
        if not line.lower().startswith("set-cookie:"):
            continue
        pair, *parts = [part.strip() for part in line.split(":", 1)[1].split(";")]
        name, _, value = pair.partition("=")
        attributes = []
        for part in parts:
            key, _, setting = part.partition("=")
            attributes.append([key.strip().lower(), setting.strip()])
        rows.append(({"name": name.strip(), "empty": value.strip() in ("", '""'),
                      "attributes": attributes}, value.strip()))
    return rows

def fill(item, values, secret):
    if isinstance(item, dict):
        return {key: fill(value, values, secret) for key, value in item.items()}
    if isinstance(item, str) and item.startswith("{{totp:"):
        return code(secret, item[7:-2])
    if isinstance(item, str) and item.startswith("{{"):
        return values[item[2:-2]]
    return item

def zap_started(zap, target):
    url = urlsplit(target)
    origin = url.scheme + "://" + url.netloc
    values = json.loads((SECRET / "account.json").read_text())
    keep("password", values["password"])
    keep("invitation token", values["invitationToken"])
    # The auth facade allows 5 counted requests per IP in a fixed 60 s window (AUTH § 3); the
    # anonymous pass just used 4 of them. Start in a fresh window instead of touching the limit.
    time.sleep(62 - time.time() % 60)
    jar, stale, secret, flow = {}, {}, None, []
    for item in json.loads(Path("/zap/wrk/flow.json").read_text()):
        if secret is None and "{{totp:" in json.dumps(item.get("body")):
            break  # enrolment failed; the shorter flow-result fails verification with its rows
        body = json.dumps(fill(item["body"], values, secret)) if "body" in item else ""
        sent = dict(stale if item.get("cookies") == "stale" else jar)
        headers = [item["method"] + " " + origin + item["path"] + " HTTP/1.1",
                   "Host: " + url.netloc, "Accept: application/json"]
        if sent:
            headers.append("Cookie: " + "; ".join(k + "=" + v for k, v in sent.items()))
        if body:
            headers += ["Origin: " + origin, "Content-Type: application/json",
                        "Content-Length: " + str(len(body.encode()))]
        message = zap.core.send_request("\\r\\n".join(headers) + "\\r\\n\\r\\n" + body,
                                        followredirects=False)
        message = message[0] if isinstance(message, list) else message
        request = message["requestHeader"].splitlines()
        response = message["responseHeader"].splitlines()
        parsed = []
        for cookie, value in cookies(response):
            parsed.append(cookie)
            if cookie["empty"]:
                if cookie["name"] in jar:
                    stale = dict(jar)
                jar.pop(cookie["name"], None)
            else:
                keep("cookie value", value)
                jar[cookie["name"]] = value
        raw = message.get("responseBody")
        try:
            data = json.loads(raw or "")
        except (ValueError, TypeError):
            data = None
        captured = False
        if item.get("capture") == "totp" and isinstance(data, dict) and \\
                str(data.get("totpURI", "")).startswith("otpauth://totp/"):
            secret = parse_qs(urlsplit(data["totpURI"]).query)["secret"][0]
            keep("TOTP secret", secret)
            captured = True
        for backup in (data.get("backupCodes") or []) if isinstance(data, dict) else []:
            keep("backup code", backup)
        session = data.get("session") if isinstance(data, dict) else None
        null = raw == "null" or (raw is None and any(h.lower() == "content-length: 4" for h in response[1:]))
        sent_names = []
        for h in request[1:]:
            if h.lower().startswith("cookie:"):
                sent_names += [p.split("=", 1)[0].strip() for p in h.split(":", 1)[1].split(";")]
        flow.append({
            "method": item["method"], "path": item["path"],
            "status": int(response[0].split()[1]),
            "code": data.get("code") if isinstance(data, dict) else None,
            "noStore": any(h.lower().startswith("cache-control:") and "no-store" in h.lower() for h in response[1:]),
            "sent": sent_names, "cookies": parsed, "captured": captured,
            "mfaVerified": bool(session.get("mfaVerifiedAt")) if isinstance(session, dict) else None,
            "twoFactorRedirect": data.get("twoFactorRedirect") if isinstance(data, dict) else None,
            "session": "none" if null else ("verified" if isinstance(session, dict) and session.get("mfaVerifiedAt") else None),
        })
    Path("/zap/wrk/flow-result.json").write_text(json.dumps(flow, indent=2))

def zap_pre_shutdown(zap):
    rows = []
    start = 0
    while True:
        messages = zap.core.messages(start=start, count=100)
        if not messages:
            break
        start += len(messages)
        for message in messages:
            method, url, _ = message["requestHeader"].splitlines()[0].split(" ", 2)
            headers = message["responseHeader"].splitlines()
            if headers[0].split()[1] == "0":
                continue
            rows.append({"method": method, "path": urlsplit(url).path,
                         "status": int(headers[0].split()[1]),
                         "cookies": [cookie for cookie, _ in cookies(headers)]})
    Path("/zap/wrk/coverage.json").write_text(json.dumps(rows, indent=2))
`;

const gitPath = (name) =>
  resolve(
    root,
    execFileSync("git", ["rev-parse", "--git-path", name], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  );

async function withApiServer(run, origin) {
  const { applicationEnvironment, compose, isolatedEnvironment } = await import(
    "../../../scripts/dev-services.mjs"
  );
  const { prepareDevelopment } = await import(
    "../../../packages/db/scripts/prepare-development.mjs"
  );
  const { seedScanInvitation } = await import("../../../apps/api/integration/browser-seed.mjs");
  const dev = await isolatedEnvironment();
  dev.DEV_BIND_ADDRESS = "127.0.0.1";
  const app = applicationEnvironment(dev);
  const secrets = mkdtempSync(gitPath("zap-api-secrets-"));
  let api;
  try {
    compose(dev, ["up", "-d", "--wait"]);
    await prepareDevelopment(dev, app);
    const account = await seedScanInvitation(dev, app);
    const production = { ...process.env, ...app, NODE_ENV: "production", PUBLIC_BASE_URL: origin };
    for (const key of [
      "BETTER_AUTH_SECRETS",
      "AUDIT_PSEUDONYM_KEY",
      "DB_AUTH_PASSWORD",
      "DB_APP_PASSWORD",
      "VALKEY_QUEUE_API_PASSWORD",
      "VALKEY_CACHE_API_PASSWORD",
    ]) {
      const path = resolve(secrets, key);
      writeFileSync(path, production[key], { mode: 0o600 });
      delete production[key];
      production[`${key}_FILE`] = path;
    }
    api = spawn(
      process.execPath,
      ["--import", "./apps/api/integration/browser-network.mjs", "apps/api/dist/server.js"],
      {
        cwd: root,
        env: production,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    await once(api, "spawn");
    return await run({ web: app.API_INTERNAL_URL, api: app.API_INTERNAL_URL, account });
  } finally {
    if (api && api.exitCode === null && api.signalCode === null) {
      const stopped = once(api, "exit");
      api.kill();
      const deadline = setTimeout(() => api.kill("SIGKILL"), 5000);
      await stopped;
      clearTimeout(deadline);
    }
    try {
      compose(dev, ["down", "--volumes", "--remove-orphans"]);
    } finally {
      rmSync(secrets, { recursive: true, force: true });
    }
  }
}

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

// The hook-based baseline omits Informational alerts from its exit code, unlike its JSON
// report. Apply our existing rule levels to that full report too (notably FAIL 10019).
export function scanStatus(exitCode, findings, rules) {
  if (![0, 1, 2].includes(exitCode)) throw new Error("ZAP scan failed");
  const levels = findings.map((finding) => rules.get(finding.id) ?? "WARN");
  if (exitCode === 1 || levels.includes("FAIL")) return 1;
  if (exitCode === 2 || levels.includes("WARN")) return 2;
  return 0;
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
// `--api`: the BL-614 anonymous pass unchanged, then the BL-614b TOTP session pass (`flow`).
export const API_SCANS = [
  { name: "api-public", entry: "/api/v1/health/ready", authenticated: false },
  { name: "api-authenticated", entry: "/api/v1/me", authenticated: false, flow: true },
];

const listFiles = (directory) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));

async function main() {
  if (process.env.BASE_URL) throw new Error("ZAP baseline scans only the local instance");
  if (process.argv.slice(2).some((arg) => arg !== "--api"))
    throw new Error("Usage: zap-baseline.mjs [--api]");
  const apiMode = process.argv.includes("--api");
  const linux = process.platform === "linux";
  const output = gitPath(apiMode ? "zap-api-baseline" : "zap-baseline");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const cache = gitPath("zap-addons");
  mkdirSync(cache, { recursive: true });
  const addOn = await betaRules(cache);
  const rules = parseRules(readFileSync(RULES_FILE, "utf8"));
  const started = Date.now();
  const port = await freePort();
  const origin = `https://localhost:${port}`;
  const scans = apiMode ? API_SCANS : SCANS;
  const withServer = apiMode ? (run) => withApiServer(run, origin) : withPerformanceServer;
  const results = await withServer(
    async (upstream) => {
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
        let ready = false;
        for (let attempt = 0; attempt < 60 && !ready; attempt++) {
          const ca = (
            await docker(["exec", edge, "cat", "/data/caddy/pki/authorities/local/root.crt"])
          ).stdout;
          ready =
            Boolean(ca) && (await probe(`https://127.0.0.1:${port}${scans[0].entry}`, ca)) === 200;
          if (!ready) await delay(500);
        }
        if (!ready) throw new Error("Caddy edge is not ready");
        const rows = [];
        for (const scan of scans) {
          const directory = resolve(output, scan.name);
          mkdirSync(directory, { recursive: true });
          copyFileSync(RULES_FILE, resolve(directory, "rules.conf"));
          if (apiMode && !scan.flow) {
            writeFileSync(resolve(directory, "requests.json"), JSON.stringify(API_REQUESTS));
            writeFileSync(resolve(directory, "api-hooks.py"), API_HOOK);
          }
          // Synthetic account and the hook's sensitive values live outside the uploaded report
          // directory and are deleted right after the scan, whatever its outcome.
          const vault = scan.flow ? mkdtempSync(gitPath("zap-api-auth-")) : null;
          if (vault) {
            writeFileSync(resolve(directory, "flow.json"), JSON.stringify(API_AUTH_FLOW));
            writeFileSync(resolve(directory, "api-hooks.py"), AUTH_HOOK);
            chmodSync(vault, 0o777);
            writeFileSync(resolve(vault, "account.json"), JSON.stringify(upstream.account), {
              mode: 0o644,
            });
          }
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
          let zap;
          let leaks = [];
          try {
            zap = await docker([
              "run",
              "--rm",
              "--network",
              `container:${edge}`,
              "--mount",
              `type=bind,source=${directory},target=/zap/wrk`,
              "--mount",
              `type=bind,source=${addOn},target=/zap/plugin/${BETA_RULES.name},readonly`,
              ...(vault ? ["--mount", `type=bind,source=${vault},target=/zap/secret`] : []),
              ...auth,
              ZAP_IMAGE,
              "zap-baseline.py",
              ...(apiMode ? ["--hook=/zap/wrk/api-hooks.py"] : []),
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
            if (vault) {
              let sensitive;
              try {
                sensitive = JSON.parse(readFileSync(resolve(vault, "sensitive.json"), "utf8"));
              } catch {
                throw new Error(
                  `ZAP ${scan.name} hook did not start; inspect ${directory}/zap.log`,
                );
              }
              const files = listFiles(directory).map((file) => [
                file.slice(output.length + 1),
                readFileSync(file, "latin1"),
              ]);
              leaks = findLeaks(files, sensitive);
            }
          } finally {
            if (vault) rmSync(vault, { recursive: true, force: true });
          }
          // Names the artefact and the kind of value only, never the value itself.
          if (leaks.length) throw new Error(`Sensitive values in scan output: ${leaks.join("; ")}`);
          const seconds = Math.round((Date.now() - begin) / 1000);
          if (![0, 1, 2].includes(zap.status))
            throw new Error(`ZAP ${scan.name} scan error; inspect ${directory}/zap.log`);
          const urls = urlTotal(zap.stdout);
          const minimum = scan.flow
            ? new Set(API_AUTH_FLOW.map((item) => `${item.method} ${item.path}`)).size
            : apiMode
              ? API_REQUESTS.length
              : MINIMUM_URLS[scan.name];
          if (urls < minimum)
            throw new Error(
              `ZAP ${scan.name} scan reached only ${urls} URLs; inspect ${directory}`,
            );
          const findings = summarize(JSON.parse(readFileSync(resolve(directory, "report.json"))));
          const coverage = () => JSON.parse(readFileSync(resolve(directory, "coverage.json")));
          let cookies = [];
          if (scan.flow)
            cookies = verifyAuthFlow(
              JSON.parse(readFileSync(resolve(directory, "flow-result.json"))),
              coverage(),
            );
          else if (apiMode) verifyApiCoverage(coverage());
          rows.push({
            scan: scan.name,
            status: scanStatus(zap.status, findings, rules),
            seconds,
            urls,
            findings,
            cookies,
          });
        }
        return rows;
      } finally {
        await docker(["rm", "-f", edge]);
      }
    },
    { edge: false },
  );
  const lines = [
    `## ZAP baseline (${apiMode ? "BL-614 anonymous + BL-614b TOTP session, API" : "BL-602"}) — ${Math.round((Date.now() - started) / 1000)} s`,
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
  // Names and attributes only (values are never recorded); every row passed cookieProblems().
  const cookies = new Map();
  for (const cookie of results.flatMap((row) => row.cookies ?? [])) {
    const attributes = cookie.attributes
      .map(([key, value]) => (key === "expires" || !value ? key : `${key}=${value}`))
      .toSorted()
      .join("; ");
    const key = `${cookie.name} ${cookie.empty ? "deleted" : "issued"} ${attributes}`;
    cookies.set(key, (cookies.get(key) ?? 0) + 1);
  }
  if (cookies.size)
    lines.push(
      "",
      "| Set-Cookie (value withheld) | Kind | Attributes | Seen |",
      "|---|---|---|---|",
      ...[...cookies].map(([key, count]) => {
        const [name, kind, ...attributes] = key.split(" ");
        return `| ${name} | ${kind} | ${attributes.join(" ")} | ${count} |`;
      }),
    );
  report(lines.join("\n"));
  // Exit 1 = a FAIL rule matched; WARN (2) is reported for the owner's decision (SEC § 9.1).
  if (results.some((row) => row.status === 1)) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
