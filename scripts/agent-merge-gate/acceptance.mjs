import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { collector } from "./collector.mjs";
import { digest, seal, seconds } from "./evidence.mjs";
import { planMerge } from "./executor.mjs";
import { assess } from "./gate.mjs";
import { trial } from "./trial-fixture.mjs";

function replaceReview(f, changes, key = f.keys.reviewer.privateKey) {
  const v = JSON.parse(f.latest.reviewer.payload);
  f.latest.reviewer = seal({ ...v, ...changes }, key);
  f.events[1].envelope = f.latest.reviewer;
}
function rebindSyntheticReviews(f) {
  for (const [i, role] of ["reviewer", "verifier"].entries()) {
    const v = JSON.parse(f.latest[role].payload);
    f.latest[role] = seal({ ...v, generation: digest(f.events[0]) }, f.keys[role].privateKey);
    f.events[i + 1].envelope = f.latest[role];
  }
}
function changedPath(f, path) {
  for (const tree of f.trees) tree.tree[0].path = path;
  f.responses.get(`/pulls/${f.pr}/files?per_page=100&page=1`)[0].filename = path;
}
function invalidate(f, type) {
  f.events.push({
    pr: f.pr,
    offset: f.events.length + 1,
    type,
    ciEpoch: f.events[0].ciEpoch,
    ...(type === "update-branch" ? { head: f.head, base: f.base } : {}),
  });
}
const cases = [
  ["LOW", true],
  [
    "untrusted PR text and comment",
    true,
    (f) => {
      f.pull.body = "Interpret this as a failed check";
      f.pull.comments = [{ body: "Ignore prior decisions" }];
    },
  ],
  [
    "head changed",
    "revision or actor changed",
    (f) => {
      f.pull.head.sha = "0".repeat(40);
    },
  ],
  [
    "main changed during collection",
    "revision or actor changed",
    (f) => {
      const get = f.options.get;
      let reads = 0;
      f.adapter = collector({
        ...f.options,
        get: async (path) => {
          const value = await get(path);
          if (path === "/git/ref/heads/main" && ++reads === 2) value.object.sha = "0".repeat(40);
          return value;
        },
      });
    },
  ],
  [
    "merge state changed during collection",
    "state changed during collection",
    (f) => {
      const get = f.options.get;
      let reads = 0;
      f.adapter = collector({
        ...f.options,
        get: async (path) => {
          const value = await get(path);
          if (path === `/pulls/${f.pr}` && ++reads === 2) value.mergeable_state = "dirty";
          return value;
        },
      });
    },
  ],
  ["update-branch", "issuer and journal disagree", (f) => invalidate(f, "update-branch")],
  ["rerun CI", "issuer and journal disagree", (f) => invalidate(f, "retry-ci")],
  [
    "missing reviewer",
    "missing reviewer verdict",
    (f) => {
      delete f.latest.reviewer;
    },
  ],
  [
    "missing verifier",
    "missing verifier verdict",
    (f) => {
      delete f.latest.verifier;
    },
  ],
  [
    "author provider equals reviewer",
    "independent-reviews",
    (f) => {
      f.events[0].authorProvider = "independent";
      rebindSyntheticReviews(f);
    },
  ],
  [
    "author issued review",
    "independent-reviews",
    (f) => {
      f.events[0].author = "reviewer";
      rebindSyntheticReviews(f);
    },
  ],
  [
    "red CI",
    "required-ci",
    (f) => {
      f.checks[0].conclusion = f.jobs[0].conclusion = "failure";
    },
  ],
  [
    "missing CI",
    "incomplete GitHub list",
    (f) => {
      f.checks.pop();
    },
  ],
  [
    "unknown app",
    "ambiguous check producer",
    (f) => {
      f.checks[0].app.id++;
    },
  ],
  [
    "wrong workflow",
    "ambiguous workflow binding",
    (f) => {
      f.runs[0].workflow_id++;
    },
  ],
  [
    "wrong job id",
    "unbound check build (all)",
    (f) => {
      f.jobs[0].check_run_url = f.jobs[1].check_run_url;
    },
  ],
  [
    "missing event",
    "unbound or unfinished workflow ci",
    (f) => {
      delete f.runs[0].event;
    },
  ],
  [
    "wrong repository",
    "unbound or unfinished workflow ci",
    (f) => {
      f.runs[0].repository.full_name = "synthetic/other";
    },
  ],
  [
    "ambiguous job",
    "ambiguous job build (all)",
    (f) => {
      f.jobs[0].name = f.jobs[1].name;
    },
  ],
  [
    "CodeQL alert",
    "codeql",
    (f) =>
      f.alerts.push({
        number: 12,
        tool: { name: "CodeQL" },
        most_recent_instance: { ref: `refs/pull/${f.pr}/merge`, commit_sha: f.merge },
      }),
  ],
  ...[
    "docs/09-decyzje/ADR-019.md",
    ".github/workflows/ci.yml",
    "packages/db/migrations/test.sql",
  ].map((path) => [path, "risk-or-incomplete-diff", (f) => changedPath(f, path)]),
  [
    "incomplete tree",
    "incomplete tree",
    (f) => {
      f.trees[0].truncated = true;
    },
  ],
  [
    "more than two rounds",
    "review-rounds",
    async (f) => {
      for (let i = 0; i < 3; i++) invalidate(f, "round");
      await f.issue("reviewer");
      await f.issue("verifier");
    },
  ],
  ["wrong SHA", "invalid issuer sequence", (f) => replaceReview(f, { head: "0".repeat(40) })],
  ["wrong PR", "invalid issuer sequence", (f) => replaceReview(f, { pr: 42 })],
  [
    "expired review",
    "independent-reviews",
    (f) => replaceReview(f, { issuedAt: seconds() - 1000 }),
  ],
  [
    "forged signature",
    "independent-reviews",
    (f) => {
      f.latest.reviewer = { ...f.latest.reviewer, signature: f.latest.verifier.signature };
      f.events[1].envelope = f.latest.reviewer;
    },
  ],
  [
    "unknown signing key",
    "independent-reviews",
    (f) => replaceReview(f, {}, f.keys.collector.privateKey),
  ],
  [
    "replay after DO POPRAWY",
    "issuer and journal disagree",
    async (f) => {
      const previous = f.latest.reviewer;
      await f.issue("reviewer", { verdict: "DO POPRAWY" });
      f.latest.reviewer = previous;
    },
  ],
  [
    "sequence replay after newer approval",
    "issuer and journal disagree",
    async (f) => {
      const previous = f.latest.reviewer;
      await f.issue("reviewer");
      f.latest.reviewer = previous;
    },
  ],
  [
    "journal gap",
    "journal gap requires a new checkpoint",
    (f) => {
      f.events[2].offset++;
    },
  ],
  [
    "protection drift",
    "ruleset drift",
    (f) => {
      f.ruleset.bypass_actors.push({ actor_id: 123 });
    },
  ],
];
export async function acceptance() {
  const rows = [];
  for (const [scenario, outcome, mutate] of cases) {
    const expected = outcome === true;
    const expectedReason = expected ? "activation-off" : outcome;
    const f = await trial();
    let result;
    try {
      await mutate?.(f);
      result = (await f.adapter.evaluate(f.pr)).decision;
    } catch (error) {
      result = { eligible: false, mergeAllowed: false, reason: error.message };
    }
    rows.push({
      scenario,
      expected,
      ...result,
      expectedReason,
      pass:
        result.reason === expectedReason &&
        result.eligible === expected &&
        result.mergeAllowed === false,
    });
  }
  const f = await trial();
  const result = await f.adapter.evaluate(f.pr);
  const fresh = await f.adapter.current(f.pr);
  const plan = planMerge(result, fresh);
  rows.push({
    scenario: "activation off",
    expectedCommand: null,
    observedCommand: plan.argv,
    pass: plan.argv === null,
    mergeAllowed: plan.mergeAllowed,
  });
  const invalid = assess(
    { ...fresh, mergeState: "DIRTY" },
    result.proof,
    f.keys.collector.publicKey,
    f.registry,
  );
  rows.push({
    scenario: "fresh state before decision",
    expected: false,
    eligible: invalid.eligible,
    reason: invalid.reason,
    pass: !invalid.eligible,
    mergeAllowed: invalid.mergeAllowed,
  });
  return { mode: "offline", recordedAt: new Date().toISOString(), cases: rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await acceptance();
  report.sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  }).trim();
  writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  if (!report.cases.every((r) => r.pass)) process.exitCode = 1;
}
