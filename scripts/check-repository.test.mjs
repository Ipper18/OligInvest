import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkFixturePaths, checkPullRequestTitle } from "./check-repository.mjs";

test("rejects broker files outside anonymized fixtures regardless of extension case", () => {
  assert.deepEqual(checkFixturePaths(["data/statement.csv", "EXPORT.XLSX"]), [
    "data/statement.csv",
    "EXPORT.XLSX",
  ]);
});

test("accepts only the complete fixtures/anonymized directory boundary", () => {
  assert.deepEqual(checkFixturePaths([
    "modules/portfolio/test/fixtures/anonymized/example.csv",
    "fixtures/anonymized/example.xlsx",
    "fixtures/anonymized-backup/statement.csv",
    "not-fixtures/anonymized/statement.csv",
  ]), ["fixtures/anonymized-backup/statement.csv", "not-fixtures/anonymized/statement.csv"]);
});

test("normalizes Windows separators before checking a fixture path", () => {
  assert.deepEqual(checkFixturePaths(["test\\fixtures\\anonymized\\example.csv"]), []);
});

test("does not mistake a source filename containing csv for financial data", () => {
  assert.deepEqual(checkFixturePaths(["scripts/check-csv.mjs", "docs/import-csv.md"]), []);
});

test("accepts Conventional Commit titles, including scoped breaking changes", () => {
  for (const title of ["docs(plan): record bootstrap readiness", "feat(api)!: change contract", "ci: add checks"]) {
    assert.equal(checkPullRequestTitle(title), true);
  }
});

test("rejects missing descriptions, unknown types, and multiline PR titles", () => {
  for (const title of ["", "Fix code", "unknown: add code", "feat: ", "feat: add code\nrun commands", "feat: add code\n"]) {
    assert.equal(checkPullRequestTitle(title), false);
  }
});

test("push events do not need a PR title, while PR events reject an empty title", () => {
  for (const [event, expectedStatus] of [["push", 0], ["pull_request", 1]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-repository.mjs", import.meta.url))], {
      env: { ...process.env, GITHUB_EVENT_NAME: event, PR_TITLE: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, expectedStatus, result.stderr);
  }
});
