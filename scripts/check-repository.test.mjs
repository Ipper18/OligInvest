import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCommit, checkFixturePaths, checkPullRequestTitle } from "./check-repository.mjs";

test("no commit SHA bypasses the commit subject rule", () => {
  const formerException = "8d91754b0adadfb5a2d7e9c2324d4e62f4125a64";
  const subject = "Document dependency readiness and split M0 CI responsibilities";
  for (const sha of [formerException, "a".repeat(40)]) {
    assert.equal(checkCommit(sha, subject), false);
  }
  assert.equal(checkCommit(formerException.slice(0, 7), "ci: verify commits"), false);
  assert.equal(checkCommit("a".repeat(40), "ci: verify commits"), true);
  assert.equal(checkPullRequestTitle(subject), false);
});

test("CLI validates actual commit ranges and independently blocks invalid PR titles", () => {
  const parent = tmpdir();
  const directory = mkdtempSync(join(parent, "oliginvest-commit-test-"));
  const git = (args) => execFileSync("git", ["-C", directory, "-c", "user.name=CI Test", "-c", "user.email=ci@example.test", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  const script = fileURLToPath(new URL("./check-repository.mjs", import.meta.url));
  try {
    git(["init", "--quiet"]);
    git(["commit", "--allow-empty", "-m", "ci: start fixture"]);
    const base = git(["rev-parse", "HEAD"]);
    git(["commit", "--allow-empty", "-m", "test(repo): verify range"]);
    const good = git(["rev-parse", "HEAD"]);
    git(["commit", "--allow-empty", "-m", "Invalid subject"]);
    const bad = git(["rev-parse", "HEAD"]);
    // GitHub "Update branch" adds a merge commit with a fixed subject; squash merge never lands it on main.
    git(["checkout", "--quiet", "-b", "side", base]);
    git(["commit", "--allow-empty", "-m", "fix(repo): side change"]);
    git(["checkout", "--quiet", "--detach", good]);
    git(["merge", "--quiet", "--no-ff", "--no-edit", "side"]);
    const merged = git(["rev-parse", "HEAD"]);
    git(["checkout", "--quiet", "--detach", "side"]);
    git(["commit", "--allow-empty", "-m", "Invalid side subject"]);
    git(["checkout", "--quiet", "--detach", merged]);
    git(["merge", "--quiet", "--no-ff", "--no-edit", "HEAD@{1}"]);
    const mergedBad = git(["rev-parse", "HEAD"]);
    for (const [head, title, status] of [[good, "ci: valid PR", 0], [bad, "ci: valid PR", 1], [good, "Invalid PR title", 1], [merged, "ci: valid PR", 0], [mergedBad, "ci: valid PR", 1]]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: directory,
        env: { ...process.env, COMMIT_BASE_REF: base, COMMIT_HEAD_REF: head, GITHUB_EVENT_NAME: "pull_request", PR_TITLE: title },
        encoding: "utf8",
      });
      assert.equal(result.status, status, result.stderr);
    }
  } finally {
    const inside = relative(parent, directory);
    assert.ok(inside.startsWith("oliginvest-commit-test-") && !isAbsolute(inside) && !inside.includes(".."));
    rmSync(directory, { recursive: true, force: true });
  }
});

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
  for (const title of ["docs(plan): record bootstrap readiness", "docs(ui,data): document shared contracts", "feat(api)!: change contract", "ci: add checks"]) {
    assert.equal(checkPullRequestTitle(title), true);
  }
});

test("rejects missing descriptions, unknown types, and multiline PR titles", () => {
  for (const title of ["", "Fix code", "unknown: add code", "feat: ", "feat: add code\nrun commands", "feat: add code\n"]) {
    assert.equal(checkPullRequestTitle(title), false);
  }
});

test("style and revert are valid types without bypassing subject validation", () => {
  for (const title of ["style(db): format MFA migration metadata", "revert(auth): restore session handling", "style: format files", "revert!: restore the previous contract"]) {
    assert.equal(checkPullRequestTitle(title), true);
    assert.equal(checkCommit("a".repeat(40), title), true);
  }
  for (const title of ["style:", "revert: ", "style: format\nextra", "revert: restore\rmalformed", "styles: format", 'Revert "previous commit"']) {
    assert.equal(checkPullRequestTitle(title), false);
    assert.equal(checkCommit("a".repeat(40), title), false);
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
