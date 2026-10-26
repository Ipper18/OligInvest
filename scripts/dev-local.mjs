import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { childEnvironment } from "./dev-environment.mjs";

// Messages contain only fixed configuration guidance, never input values or provider errors.
export class DevelopmentError extends Error {}

export function requireDevelopment(env) {
  if (env.NODE_ENV !== "development" || env.DB_NAME !== "oliginvest_dev")
    throw new DevelopmentError("Local accounts require development and DB_NAME=oliginvest_dev");
}

export function developmentOptions(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      check: { type: "boolean" },
      "create-owner": { type: "boolean" },
      email: { type: "string" },
      name: { type: "string" },
    },
  });
  if (values.check && Object.keys(values).length !== 1)
    throw new Error("Unexpected check arguments");
  if (values["create-owner"] ? !values.email || !values.name : values.email || values.name)
    throw new Error("Use --create-owner --email <email> --name <name>");
  return values;
}

export function developmentProfile(dev) {
  requireDevelopment(dev);
  const profile = dev.DEV_PROFILE || "demo";
  if (!["demo", "owner"].includes(profile))
    throw new DevelopmentError("DEV_PROFILE must be demo or owner");
  const project = profile === "owner" ? "oliginvest-dev-owner" : "oliginvest-dev";
  if (dev.COMPOSE_PROJECT_NAME && dev.COMPOSE_PROJECT_NAME !== project)
    throw new DevelopmentError(`This profile requires COMPOSE_PROJECT_NAME=${project}`);
  return { ...dev, DEV_PROFILE: profile, COMPOSE_PROJECT_NAME: project };
}

export function requireOwnerTerminal(dev, input = process.stdin, output = process.stdout) {
  requireDevelopment(dev);
  if (dev.DEV_PROFILE !== "owner")
    throw new DevelopmentError("--create-owner requires DEV_PROFILE=owner");
  if (!input.isTTY || !output.isTTY)
    throw new DevelopmentError("--create-owner requires an interactive TTY");
}

export function createDevelopmentOwner(dev, env, options, cwd) {
  requireOwnerTerminal(dev);
  requireDevelopment(env);
  // No shell, no password argument, no output capture, and no timeout during operator input.
  const result = spawnSync(
    process.execPath,
    [
      "apps/api/dist/admin-cli.js",
      "create-owner",
      "--email",
      options.email,
      "--name",
      options.name,
      "--reason",
      "Utworzenie lokalnego profilu właściciela",
    ],
    { cwd, env: childEnvironment(env, "api"), stdio: "inherit" },
  );
  if (result.error || result.status !== 0)
    throw new DevelopmentError("Local owner creation failed");
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
    if (!/^[a-f0-9]{64}$/u.test(value))
      throw new DevelopmentError(`Invalid ${key}: expected 64 hex characters`);
    if (file[key] && file[key] !== value)
      throw new DevelopmentError(`Conflicting ${key} in environment and .env`);
    keys[key] = value;
    if (!file[key]) additions.push(`${key}=${value}`);
  }
  if (additions.length) await appendFile(path, `\n${additions.join("\n")}\n`, { mode: 0o600 });
  return { ...dev, ...keys };
}
