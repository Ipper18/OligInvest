import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, configSchemas, loadConfig } from "@oliginvest/config";
import { afterEach, expect, test } from "vitest";

const folders = [];
const secret = () => randomBytes(32).toString("hex");
function file(value) {
  const folder = mkdtempSync(join(tmpdir(), "oliginvest-config-test-"));
  folders.push(folder);
  const path = join(folder, "value");
  writeFileSync(path, value);
  return path;
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!folder.startsWith(join(tmpdir(), "oliginvest-config-test-")))
      throw new Error("Unsafe cleanup");
    rmSync(folder, { recursive: true });
  }
});
const web = {
  PUBLIC_BASE_URL: "https://example.test",
  API_INTERNAL_URL: "http://api.example.test",
};
const api = () => ({
  PUBLIC_BASE_URL: web.PUBLIC_BASE_URL,
  BETTER_AUTH_SECRETS: `2:${secret()},1:${secret()}`,
  AUDIT_PSEUDONYM_KEY: secret(),
  DB_AUTH_PASSWORD: secret(),
  DB_APP_PASSWORD: secret(),
  VALKEY_QUEUE_API_PASSWORD: secret(),
  VALKEY_CACHE_API_PASSWORD: secret(),
});
const local = { mode: "test" };

test("every schema key exists in the public environment template", () => {
  const template = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const keys = new Set([...template.matchAll(/^([A-Z_]+)=/gm)].map((match) => match[1]));
  for (const schema of Object.values(configSchemas)) {
    for (const key of Object.keys(schema.shape)) expect(keys.has(key), key).toBe(true);
  }
});
test("mode is explicit, nonsecret FILE keys fail and outputs are immutable", () => {
  expect(() => loadConfig("web", web, { mode: "unknown" })).toThrow(/invalid_mode/);
  expect(() =>
    loadConfig(
      "web",
      { API_INTERNAL_URL: web.API_INTERNAL_URL, PUBLIC_BASE_URL_FILE: file(web.PUBLIC_BASE_URL) },
      local,
    ),
  ).toThrow(/file_not_supported/);
  expect(Object.isFrozen(loadConfig("web", web, local))).toBe(true);
});

test("each service validates only its keys; system/MCP/foreign secrets are not returned or read", () => {
  expect(
    loadConfig("web", { ...web, PATH: "irrelevant", DB_APP_PASSWORD_FILE: "missing" }, local),
  ).toEqual(web);
  expect(loadConfig("api", api(), local).BETTER_AUTH_SECRETS).toMatch(/^2:/);
  expect(
    loadConfig(
      "analytics",
      { DB_ANALYTICS_RO_PASSWORD: secret(), VALKEY_QUEUE_ANALYTICS_PASSWORD: secret() },
      local,
    ),
  ).toHaveProperty("DB_ANALYTICS_RO_PASSWORD");
  const values = {
    PUBLIC_BASE_URL: web.PUBLIC_BASE_URL,
    AUDIT_PSEUDONYM_KEY: secret(),
    DB_APP_PASSWORD: secret(),
    VALKEY_QUEUE_JOBS_PASSWORD: secret(),
    VALKEY_CACHE_JOBS_PASSWORD: secret(),
  };
  expect(loadConfig("jobs", values, local)).toEqual(values);
  expect(() => configSchemas.web.parse({ ...web, unknown: "no" })).toThrow();
});
test("missing required keys fail without exposing supplied values", () => {
  const marker = secret();
  expect(() => loadConfig("api", { BETTER_AUTH_SECRETS: marker }, local)).toThrow(ConfigError);
  try {
    loadConfig("api", { BETTER_AUTH_SECRETS: marker }, local);
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(error.message).not.toContain(marker);
    expect(error.cause).toBeUndefined();
  }
});
test("production accepts secret files with one trailing CRLF, never direct secrets", () => {
  const values = api();
  const env = Object.fromEntries(
    Object.entries(values).map(([key, value]) =>
      key === "PUBLIC_BASE_URL" ? [key, value] : [`${key}_FILE`, file(`${value}\r\n`)],
    ),
  );
  expect(loadConfig("api", env, { mode: "production" })).toEqual(values);
  expect(() => loadConfig("api", values, { mode: "production" })).toThrow(/file_required/);
});
test("conflicting sources, relative/unreadable/empty/oversized/invalid UTF-8 files fail safely", () => {
  const values = api();
  expect(() =>
    loadConfig("api", { ...values, DB_APP_PASSWORD_FILE: file(secret()) }, local),
  ).toThrow(/conflicting_sources/);
  for (const path of [
    "relative-file",
    file(""),
    file("x".repeat(65537)),
    file(Buffer.from([0xff])),
  ]) {
    const input = { ...values, DB_APP_PASSWORD: "", DB_APP_PASSWORD_FILE: path };
    try {
      loadConfig("api", input, local);
      throw new Error("Should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).not.toContain(path);
    }
  }
  const missing = `${file("unused")}-missing`;
  expect(() =>
    loadConfig("api", { ...values, DB_APP_PASSWORD: "", DB_APP_PASSWORD_FILE: missing }, local),
  ).toThrow(/file_unreadable/);
});
test("file reading preserves spaces; no fallback to empty direct values", () => {
  const values = api();
  expect(
    loadConfig(
      "api",
      { ...values, DB_APP_PASSWORD: "", DB_APP_PASSWORD_FILE: file(" leading and trailing \n") },
      local,
    ).DB_APP_PASSWORD,
  ).toBe(" leading and trailing ");
  expect(() =>
    loadConfig("api", { ...values, DB_APP_PASSWORD: "", DB_APP_PASSWORD_FILE: file("\n") }, local),
  ).toThrow();
});
test("versioned secrets reject duplicates, invalid versions and short historical keys", () => {
  for (const value of [
    `1:${secret()},1:${secret()}`,
    `1x:${secret()}`,
    `-1:${secret()}`,
    `1:${secret()},0:short`,
    `1:${secret()},`,
  ]) {
    expect(() => loadConfig("api", { ...api(), BETTER_AUTH_SECRETS: value }, local)).toThrow();
  }
});
test("URLs reject credentials/query/fragment, non-HTTP protocols and insecure public production origin", () => {
  for (const url of [
    "ftp://example.test",
    "https://user:pass@example.test",
    "https://example.test/?token=private",
    "https://example.test/#private",
    "https://example.test/path",
  ]) {
    expect(() => loadConfig("web", { ...web, PUBLIC_BASE_URL: url }, local)).toThrow();
  }
  expect(() =>
    loadConfig("web", { ...web, PUBLIC_BASE_URL: "http://example.test" }, { mode: "production" }),
  ).toThrow();
  expect(loadConfig("web", web, { mode: "production" })).toEqual(web);
});
test("optional auth/notification credentials form complete groups", () => {
  expect(() => loadConfig("api", { ...api(), GOOGLE_CLIENT_ID: "test-client" }, local)).toThrow(
    /incomplete_group/,
  );
  const values = {
    PUBLIC_BASE_URL: web.PUBLIC_BASE_URL,
    AUDIT_PSEUDONYM_KEY: secret(),
    DB_APP_PASSWORD: secret(),
    VALKEY_QUEUE_JOBS_PASSWORD: secret(),
    VALKEY_CACHE_JOBS_PASSWORD: secret(),
  };
  expect(() => loadConfig("jobs", { ...values, SMTP_HOST: "smtp.example.test" }, local)).toThrow(
    /incomplete_group/,
  );
  expect(loadConfig("jobs", { ...values, FINNHUB_API_KEY: "" }, local)).not.toHaveProperty(
    "FINNHUB_API_KEY",
  );
});
