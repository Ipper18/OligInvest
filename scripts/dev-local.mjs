import { randomBytes } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

export function requireDevelopment(env) {
  if (env.NODE_ENV !== "development" || env.DB_NAME !== "oliginvest_dev")
    throw new Error("Local accounts require development and DB_NAME=oliginvest_dev");
}

// Read only the two local keys; never print the file or generated values.
export async function persistDevelopmentSecrets(dev, path) {
  requireDevelopment(dev);
  let file = {};
  try {
    file = parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const additions = [];
  const keys = {};
  for (const key of ["DEV_AUTH_SECRET", "DEV_AUDIT_KEY"]) {
    const value = dev[key] || file[key] || randomBytes(32).toString("hex");
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${key}: expected 64 hex characters`);
    if (file[key] && file[key] !== value) throw new Error(`Conflicting ${key} in environment and .env`);
    keys[key] = value;
    if (!file[key]) additions.push(`${key}=${value}`);
  }
  if (additions.length) await appendFile(path, `\n${additions.join("\n")}\n`, { mode: 0o600 });
  return { ...dev, ...keys };
}
