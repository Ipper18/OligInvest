import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { generateModule } from "./gen-module.mjs";

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "oliginvest-generator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "modules"));
  return root;
}

test("creates the complete feature structure and four public entry points", (t) => {
  const root = workspace(t);
  generateModule(root, "sample-feature");
  const path = join(root, "modules/sample-feature");
  const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  assert.equal(manifest.name, "@oliginvest/mod-sample-feature");
  assert.deepEqual(Object.keys(manifest.exports).sort(), [
    "./contracts",
    "./jobs",
    "./server",
    "./ui",
  ]);
  assert.deepEqual(manifest.dependencies, { "@oliginvest/platform": "workspace:*" });
  for (const file of [
    "src/contracts.ts",
    "src/domain/index.ts",
    "src/server/index.ts",
    "src/module.ts",
    "src/jobs.ts",
    "src/ui/index.ts",
    "src/ui-module.ts",
    "db/schema.ts",
    "db/rls.sql",
    "test/module.test.mjs",
    "test/fixtures/anonymized/.gitkeep",
    "tsconfig.json",
    "README.md",
  ]) {
    assert.ok(existsSync(join(path, file)), file);
  }
  assert.match(readFileSync(join(path, "src/contracts.ts"), "utf8"), /module.sample-feature/);
});

test("never overwrites an existing module", (t) => {
  const root = workspace(t);
  mkdirSync(join(root, "modules/example"));
  writeFileSync(join(root, "modules/example/owned.txt"), "preserve");
  assert.throws(() => generateModule(root, "example"), /istnieje/);
  assert.equal(readFileSync(join(root, "modules/example/owned.txt"), "utf8"), "preserve");
  assert.equal(existsSync(join(root, "modules/example/package.json")), false);
});

test("formats the longest accepted module name", (t) => {
  const root = workspace(t);
  const name = "x".repeat(64);
  generateModule(root, name);
  assert.ok(existsSync(join(root, "modules", name, "test/module.test.mjs")));
});

for (const name of [
  "",
  "../escape",
  "a/b",
  "a\\b",
  "A",
  "a--b",
  "a-",
  "1a",
  "a b",
  "con",
  "com1",
  "identity",
  "notifications",
  "market",
  "portfolio",
  "admin",
  "x".repeat(65),
]) {
  test(`rejects invalid or reserved name ${JSON.stringify(name)}`, (t) => {
    const root = workspace(t);
    assert.throws(() => generateModule(root, name), /nazwa/);
  });
}

test("CLI validates argument count and reports success", (t) => {
  const root = workspace(t);
  const script = resolve("scripts/gen-module.mjs");
  for (const args of [[], ["one", "two"]]) {
    const run = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
  }
  const run = spawnSync(process.execPath, [script, "sample-feature"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(join(root, "modules/sample-feature/package.json")));
});
