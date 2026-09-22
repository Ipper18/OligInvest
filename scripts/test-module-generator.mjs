import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = process.cwd();
const gitDirectory = resolve(
  root,
  execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim(),
);
const sandbox = mkdtempSync(join(gitDirectory, "bl004-generator-"));
const log = join(gitDirectory, "bl004-generator.log");
writeFileSync(log, "");

function pnpm(args) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: launcher metadata; this script is not a cached Turbo task.
  const launcher = process.env.npm_execpath;
  if (!launcher) throw new Error("Uruchom przez pnpm test:module-generator.");
  const javascript = /\.[cm]?js$/u.test(launcher);
  const result = spawnSync(
    javascript ? process.execPath : launcher,
    javascript ? [launcher, ...args] : args,
    {
      cwd: sandbox,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    },
  );
  appendFileSync(log, `\n> pnpm ${args.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error || result.status !== 0)
    throw new Error(`Błąd: pnpm ${args.join(" ")}; szczegóły: ${log}`);
}

try {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "turbo.json",
    ".npmrc",
  ]) {
    cpSync(join(root, file), join(sandbox, file));
  }
  const biome = JSON.parse(readFileSync(join(root, "biome.json"), "utf8"));
  biome.vcs.enabled = false; // The temporary workspace lives inside the ignored .git directory.
  writeFileSync(join(sandbox, "biome.json"), JSON.stringify(biome));
  cpSync(join(root, "packages/platform"), join(sandbox, "packages/platform"), {
    recursive: true,
    filter: (path) => !["node_modules", "dist", ".turbo"].includes(basename(path)),
  });
  mkdirSync(join(sandbox, "modules"));
  mkdirSync(join(sandbox, "scripts"));
  for (const script of ["gen-module.mjs", "check-deps.mjs"])
    cpSync(join(root, "scripts", script), join(sandbox, "scripts", script));
  pnpm(["gen:module", "sample-feature"]);
  pnpm(["install", "--lockfile-only", "--offline"]);
  pnpm(["install", "--frozen-lockfile", "--offline"]);
  pnpm(["check:deps"]);
  pnpm([
    "turbo",
    "run",
    "lint",
    "typecheck",
    "test",
    "build",
    "--filter=@oliginvest/mod-sample-feature",
    "--output-logs=errors-only",
  ]);
  console.log("Generator: lint, typecheck, test, build i check:deps PASS.");
} catch (error) {
  console.error(error.message);
  console.error(readFileSync(log, "utf8").split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  const withinGit = relative(gitDirectory, resolve(sandbox));
  if (!withinGit.startsWith("..") && basename(sandbox).startsWith("bl004-generator-")) {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
