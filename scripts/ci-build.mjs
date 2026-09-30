import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const root = process.cwd();
const omit = process.argv.filter((arg) => arg !== "--")[2];
if (!["none", "analytics", "alerts", "education", "admin", "quick-actions"].includes(omit))
  throw new Error("Expected none or a functional module name");
const git = resolve(root, execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim());
const sandbox = omit === "none" ? root : mkdtempSync(join(git, "ci-build-"));
const launcher = process.env.npm_execpath;
if (!launcher) throw new Error("Run through pnpm ci:build");
function run(command, args, cwd = sandbox) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) throw new Error(`Build command failed: ${command}`);
}
function pnpm(args) {
  const js = /\.[cm]?js$/u.test(launcher);
  run(js ? process.execPath : launcher, js ? [launcher, ...args] : args);
}
try {
  if (omit !== "none") {
    // Copy tracked inputs, never installed packages or cached build outputs.
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of files) {
      if (file.startsWith(`modules/${omit}/`)) continue;
      const target = join(sandbox, file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, file), target);
    }
    // Turbo discovers the isolated workspace through its own Git root.
    run("git", ["init", "--quiet"]);
    pnpm(["install", "--frozen-lockfile"]);
    run("uv", ["sync", "--project", "apps/analytics", "--frozen", "--no-install-project", "--no-build", "--no-python-downloads"]);
    run("uv", ["sync", "--project", "apps/analytics", "--frozen", "--no-build-isolation", "--no-python-downloads"]);
    pnpm(["check:deps"]);
    const lock = readFileSync(join(root, "pnpm-lock.yaml"));
    if (!lock.equals(readFileSync(join(sandbox, "pnpm-lock.yaml")))) throw new Error("Frozen lockfile changed");
  }
  pnpm(["turbo", "run", "build", "--output-logs=new-only"]);
  console.log(`build (${omit === "none" ? "all" : `without ${omit}`}): PASS`);
} finally {
  if (sandbox !== root) {
    const inside = relative(git, sandbox);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error("Unsafe build sandbox cleanup");
    rmSync(sandbox, { recursive: true, force: true });
  }
}
