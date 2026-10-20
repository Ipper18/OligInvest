import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export function checkContexts(workflows, ruleset) {
  const contexts = [];
  for (const workflow of workflows) {
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.ok(workflow.on.pull_request !== undefined || "pull_request" in workflow.on);
    assert.ok(!("pull_request_target" in workflow.on));
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (id === "release") {
        assert.equal(job.if, "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')");
        assert.deepEqual(workflow.on.push.tags, ["v*.*.*"]);
        assert.deepEqual(job.permissions, { contents: "write", packages: "write", "id-token": "write", attestations: "write" });
        assert.equal(job.needs, "images");
        for (const step of job.steps ?? []) {
          if (step.uses) assert.match(step.uses, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
        }
        continue;
      }
      assert.ok(!job.permissions || Object.values(job.permissions).every((value) => value === "read" || value === "none"), "PR jobs must be read-only");
      const matrix = job.strategy?.matrix;
      let variants = [{}];
      if (matrix?.include) variants = matrix.include;
      else if (matrix) {
        for (const [axis, values] of Object.entries(matrix)) {
          variants = variants.flatMap((variant) => values.map((value) => ({ ...variant, [axis]: value })));
        }
      }
      for (const variant of variants) {
        const name = (job.name ?? id).replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => {
          assert.ok(key in variant, `Missing matrix value: ${key}`);
          return variant[key];
        });
        assert.ok(!name.includes("${{"), `Unresolved check name: ${name}`);
        contexts.push(name);
      }
      for (const step of job.steps ?? []) {
        if (step.uses) assert.match(step.uses, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
      }
    }
  }
  assert.equal(new Set(contexts).size, contexts.length, "Duplicate check names across workflows");
  const rules = ruleset.rules.filter((rule) => rule.type === "required_status_checks");
  assert.equal(rules.length, 1);
  const required = rules[0].parameters.required_status_checks.map((check) => check.context);
  assert.deepEqual(required.toSorted(), contexts.toSorted(), "Ruleset must match every real workflow check");
  return contexts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workflows = readdirSync(".github/workflows")
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => parse(readFileSync(`.github/workflows/${name}`, "utf8")));
  const contexts = checkContexts(workflows, JSON.parse(readFileSync(".github/rulesets/main.json", "utf8")));
  console.log(`Workflow/ruleset: ${contexts.length} unique contexts, SHA pins and read-only permissions PASS`);
}
