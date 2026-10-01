import assert from "node:assert/strict";
import test from "node:test";
import { checkContexts } from "./check-ci.mjs";

const workflow = {
  on: { pull_request: null }, permissions: { contents: "read" },
  jobs: { build: { name: "${{ matrix.name }}", strategy: { matrix: { include: [{ name: "build (all)" }, { name: "build (without education)" }] } } }, workers: {} },
};
const ruleset = { rules: [{ type: "required_status_checks", parameters: { required_status_checks: ["build (all)", "build (without education)", "workers"].map((context) => ({ context })) } }] };
test("matrix names are expanded and match the ruleset exactly", () => {
  assert.equal(checkContexts([workflow], ruleset).length, 3);
});
test("duplicate workflow checks cannot masquerade as a single required check", () => {
  assert.throws(() => checkContexts([workflow, workflow], ruleset), /Duplicate/);
});
test("missing workers and fictional budgets checks fail", () => {
  for (const name of ["workers", "budgets"]) {
    const changed = structuredClone(ruleset);
    const checks = changed.rules[0].parameters.required_status_checks;
    if (name === "workers") checks.pop(); else checks.push({ context: name });
    assert.throws(() => checkContexts([workflow], changed), /Ruleset/);
  }
});
test("unpinned actions and writable permissions fail", () => {
  const unpinned = structuredClone(workflow);
  unpinned.jobs.workers.steps = [{ uses: "actions/checkout@v5" }];
  assert.throws(() => checkContexts([unpinned], ruleset));
  const writable = structuredClone(workflow);
  writable.permissions.contents = "write";
  assert.throws(() => checkContexts([writable], ruleset));
});

test("write permissions are restricted to the guarded tag release job", () => {
  const changed = structuredClone(workflow);
  changed.jobs.workers.permissions = { packages: "write" };
  assert.throws(() => checkContexts([changed], ruleset), /read-only/);
  delete changed.jobs.workers.permissions;
  changed.on.push = { tags: ["v*.*.*"] };
  changed.jobs.release = {
    if: "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    needs: "images",
    permissions: { contents: "write", packages: "write", "id-token": "write", attestations: "write" },
  };
  assert.equal(checkContexts([changed], ruleset).length, 3);
  changed.jobs.release.if = "always()";
  assert.throws(() => checkContexts([changed], ruleset));
});
