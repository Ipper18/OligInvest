import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

const text = z
  .string()
  .min(1)
  .max(65536)
  .refine((value) =>
    [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
  );
const httpUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  );
});
const publicUrl = httpUrl.refine((value) => new URL(value).pathname === "/");
const versionedSecrets = text.refine((value) => {
  const versions = new Set<number>();
  return value.split(",").every((entry) => {
    const match = /^(0|[1-9]\d*):(.+)$/u.exec(entry.trim());
    if (!match?.[1] || !match[2] || match[2].trim().length < 32) return false;
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || versions.has(version)) return false;
    versions.add(version);
    return true;
  });
});
const legal = { LEGAL_CONTROLLER_NAME: text.optional(), LEGAL_CONTACT_EMAIL: z.email().optional() };
const push = { VAPID_PUBLIC_KEY: text.optional(), VAPID_PRIVATE_KEY: text.optional() };
export const configSchemas = {
  web: z.object({ PUBLIC_BASE_URL: publicUrl, API_INTERNAL_URL: httpUrl, ...legal }).strict(),
  api: z
    .object({
      PUBLIC_BASE_URL: publicUrl,
      BETTER_AUTH_SECRETS: versionedSecrets,
      AUDIT_PSEUDONYM_KEY: text.min(32),
      DB_AUTH_PASSWORD: text,
      DB_APP_PASSWORD: text,
      VALKEY_QUEUE_API_PASSWORD: text,
      VALKEY_CACHE_API_PASSWORD: text,
      ...legal,
      VAPID_PUBLIC_KEY: text.optional(),
      GOOGLE_CLIENT_ID: text.optional(),
      GOOGLE_CLIENT_SECRET: text.optional(),
      GITHUB_CLIENT_ID: text.optional(),
      GITHUB_CLIENT_SECRET: text.optional(),
    })
    .strict(),
  jobs: z
    .object({
      PUBLIC_BASE_URL: publicUrl,
      AUDIT_PSEUDONYM_KEY: text.min(32),
      DB_APP_PASSWORD: text,
      VALKEY_QUEUE_JOBS_PASSWORD: text,
      VALKEY_CACHE_JOBS_PASSWORD: text,
      SMTP_HOST: z.hostname().optional(),
      SMTP_USER: text.optional(),
      SMTP_PASSWORD: text.optional(),
      ...push,
      FINNHUB_API_KEY: text.optional(),
      TWELVEDATA_API_KEY: text.optional(),
      ALPHAVANTAGE_API_KEY: text.optional(),
      FRED_API_KEY: text.optional(),
      MARKETAUX_API_KEY: text.optional(),
    })
    .strict(),
  analytics: z
    .object({ DB_ANALYTICS_RO_PASSWORD: text, VALKEY_QUEUE_ANALYTICS_PASSWORD: text })
    .strict(),
} as const;
export type Service = keyof typeof configSchemas;
export type ServiceConfig<S extends Service> = z.output<(typeof configSchemas)[S]>;
export type ConfigMode = "development" | "test" | "production";
type ConfigIssue = Readonly<{ key: string; code: string }>;
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    super(`Invalid configuration: ${issues.map(({ key, code }) => `${key} (${code})`).join(", ")}`);
    this.name = "ConfigError";
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

const SECRET_KEYS = new Set([
  "BETTER_AUTH_SECRETS",
  "AUDIT_PSEUDONYM_KEY",
  "DB_AUTH_PASSWORD",
  "DB_APP_PASSWORD",
  "DB_ANALYTICS_RO_PASSWORD",
  "VALKEY_QUEUE_API_PASSWORD",
  "VALKEY_CACHE_API_PASSWORD",
  "VALKEY_QUEUE_JOBS_PASSWORD",
  "VALKEY_CACHE_JOBS_PASSWORD",
  "VALKEY_QUEUE_ANALYTICS_PASSWORD",
  "VAPID_PRIVATE_KEY",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "FINNHUB_API_KEY",
  "TWELVEDATA_API_KEY",
  "ALPHAVANTAGE_API_KEY",
  "FRED_API_KEY",
  "MARKETAUX_API_KEY",
]);
const GROUPS = [
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
  ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
];
function readSecretFile(path: string): string {
  if (!isAbsolute(path)) throw new Error("file_unreadable");
  const descriptor = openSync(path, "r");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65536) throw new Error("file_unreadable");
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > 65536) throw new Error("file_unreadable");
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer.subarray(0, size))
      .replace(/\r?\n$/u, "");
  } finally {
    closeSync(descriptor);
  }
}

/** No implicit environment reads; only a service's declared keys are exposed. */
export function loadConfig<S extends Service>(
  service: S,
  env: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ mode: ConfigMode }>,
): Readonly<ServiceConfig<S>> {
  if (!["development", "test", "production"].includes(options.mode)) {
    throw new ConfigError([{ key: "mode", code: "invalid_mode" }]);
  }
  const schema = configSchemas[service];
  const selected: Record<string, string> = {};
  const issues: ConfigIssue[] = [];
  for (const key of Object.keys(schema.shape)) {
    const direct = env[key]?.trim() ? env[key] : undefined;
    const path = env[`${key}_FILE`]?.trim() ? env[`${key}_FILE`] : undefined;
    if (direct !== undefined && path !== undefined) {
      issues.push({ key, code: "conflicting_sources" });
      continue;
    }
    if (path !== undefined) {
      if (!SECRET_KEYS.has(key)) {
        issues.push({ key, code: "file_not_supported" });
        continue;
      }
      try {
        selected[key] = readSecretFile(path);
      } catch {
        issues.push({ key, code: "file_unreadable" });
      }
    } else if (direct !== undefined) {
      if (options.mode === "production" && SECRET_KEYS.has(key))
        issues.push({ key, code: "file_required" });
      else selected[key] = direct;
    }
  }
  if (
    options.mode === "production" &&
    selected.PUBLIC_BASE_URL &&
    !selected.PUBLIC_BASE_URL.startsWith("https://")
  ) {
    issues.push({ key: "PUBLIC_BASE_URL", code: "https_required" });
  }
  for (const group of GROUPS) {
    const applicable = group.filter((key) => key in schema.shape);
    const present = applicable.filter((key) => selected[key] !== undefined);
    if (present.length > 0 && present.length < applicable.length) {
      for (const key of applicable)
        if (selected[key] === undefined) issues.push({ key, code: "incomplete_group" });
    }
  }
  const result = schema.safeParse(selected);
  if (!result.success) {
    for (const issue of result.error.issues)
      issues.push({ key: String(issue.path[0]), code: "invalid_value" });
  }
  if (!result.success || issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(result.data) as Readonly<ServiceConfig<S>>;
}
