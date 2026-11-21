import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("the E2E process runner propagates a failed browser suite to CI", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ci-e2e-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "playwright.log");
  const runner = new URL("./dev-services.mjs", import.meta.url).href;
  const suite = 'console.error("simulated failing assertion"); process.exit(17)';
  const script = `import { run } from ${JSON.stringify(runner)};
    run(process.execPath, ["-e", ${JSON.stringify(suite)}], { log: ${JSON.stringify(log)} });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Command failed/);
  assert.match(readFileSync(log, "utf8"), /simulated failing assertion/);
});
