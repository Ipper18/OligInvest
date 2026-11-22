import { canonical, digest, need, positive, repo } from "./evidence.mjs";
import { requiredContexts } from "./gate.mjs";
import { apiRoot, pages, unique } from "./github.mjs";
import { distinctJobs, jobKeyFor, proven, workflowFor } from "./provenance.mjs";

export async function ciEpoch(get, head, merge) {
  const runs = [];
  for (const sha of [head, merge]) {
    runs.push(
      ...(await pages(get, `/actions/runs?head_sha=${sha}&event=pull_request`, "workflow_runs")),
    );
  }
  unique(runs, "id");
  return digest(
    runs
      .sort((a, b) => a.id - b.id)
      .map((run) => {
        need(positive(run.run_attempt), "unknown CI attempt");
        return [run.id, run.run_attempt];
      }),
  );
}
export async function ciEvidence(get, scope, pins, mergeSha) {
  const commits = [scope.head, mergeSha];
  const runs = [],
    checks = [];
  for (const sha of commits) {
    runs.push(
      ...(await pages(get, `/actions/runs?head_sha=${sha}&event=pull_request`, "workflow_runs")),
    );
    checks.push(...(await pages(get, `/commits/${sha}/check-runs?filter=all`, "check_runs")));
  }
  unique(runs, "id");
  unique(checks, "id");
  const evidence = [];
  for (const workflow of new Set(requiredContexts.map(workflowFor))) {
    const path = `.github/workflows/${workflow}.yml`;
    const candidates = runs.filter(
      (r) => r.path === path || r.workflow_id === pins.workflows[workflow],
    );
    need(
      candidates.every(
        (r) =>
          r.path === path &&
          r.workflow_id === pins.workflows[workflow] &&
          r.pull_requests?.length === 1 &&
          r.pull_requests[0].number === scope.pr,
      ),
      "ambiguous workflow binding",
    );
    need(candidates.length, `missing workflow ${workflow}`);
    candidates.sort((a, b) => b.run_number - a.run_number);
    const run = candidates[0];
    need(
      candidates.slice(1).every((r) => Date.parse(r.updated_at) < Date.parse(run.updated_at)),
      "ambiguous latest workflow attempt",
    );
    const bindings = run.pull_requests.filter((p) => p.number === scope.pr);
    need(
      positive(run.run_number) &&
        candidates[1]?.run_number !== run.run_number &&
        run.workflow_id === pins.workflows[workflow] &&
        run.event === "pull_request" &&
        run.repository.full_name === repo &&
        run.head_repository.full_name === repo &&
        bindings.length === 1 &&
        bindings[0].head.sha === scope.head &&
        bindings[0].base.sha === scope.base &&
        commits.includes(run.head_sha) &&
        run.status === "completed" &&
        positive(run.run_attempt),
      `unbound or unfinished workflow ${workflow}`,
    );
    const jobs = unique(
      await pages(get, `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs"),
      "id",
    );
    const previousCheckUrls = new Set();
    need(run.run_attempt <= 100, "attempt limit reached");
    for (let attempt = 1; attempt < run.run_attempt; attempt++) {
      const prior = await pages(get, `/actions/runs/${run.id}/attempts/${attempt}/jobs`, "jobs");
      for (const job of prior) {
        need(job.run_id === run.id && job.status === "completed", "ambiguous previous job");
        previousCheckUrls.add(job.check_run_url);
      }
    }
    for (const name of requiredContexts.filter((n) => workflowFor(n) === workflow)) {
      const matching = jobs.filter((j) => j.name === name);
      need(matching.length === 1, `ambiguous job ${name}`);
      const job = matching[0];
      const matched = checks.filter(
        (c) => c.name === name && c.check_suite?.id === run.check_suite_id,
      );
      // Prior attempts in the same suite may exist. Reject unknown siblings and unfinished reruns.
      const check = matched.find((c) => job.check_run_url === `${apiRoot}/check-runs/${c.id}`);
      need(
        check &&
          positive(run.check_suite_id) &&
          job.run_id === run.id &&
          (job.run_attempt === undefined || job.run_attempt === run.run_attempt) &&
          job.status === "completed" &&
          job.head_sha === run.head_sha &&
          check.head_sha === run.head_sha &&
          check.status === "completed" &&
          check.conclusion === job.conclusion &&
          matched.every(
            (c) =>
              c.id === check.id ||
              (previousCheckUrls.has(`${apiRoot}/check-runs/${c.id}`) && c.status === "completed"),
          ),
        `unbound check ${name}`,
      );
      // A same-name run outside the known workflow's history cannot substitute for this job.
      need(
        checks
          .filter((c) => c.name === name)
          .every(
            (c) =>
              c.app?.id === pins.actionsAppId &&
              candidates.some((r) => r.check_suite_id === c.check_suite?.id),
          ),
        "ambiguous check producer",
      );
      const entry = {
        ...scope,
        name,
        conclusion: check.conclusion,
        provenance: {
          repo: run.repository.full_name,
          workflowId: run.workflow_id,
          workflowPath: run.path,
          event: run.event,
          runId: run.id,
          attempt: run.run_attempt,
          jobId: job.id,
          jobKey: jobKeyFor(name),
          jobName: job.name,
          checkId: check.id,
          appId: check.app.id,
        },
      };
      need(proven(entry, pins), `untrusted check ${name}`);
      evidence.push(entry);
    }
  }
  distinctJobs(evidence);
  return evidence;
}
async function analyzedAlerts(get, ref, sha, pins) {
  const query = `?ref=${encodeURIComponent(ref)}&tool_name=CodeQL`;
  const analyses = unique(await pages(get, `/code-scanning/analyses${query}`), "id").filter(
    (a) => a.commit_sha === sha && a.ref === ref && a.tool.name === "CodeQL",
  );
  // Pin separate analysis keys/categories for each required language in the owner's registry.
  const expected = pins.codeql;
  need(
    Array.isArray(expected) &&
      ["actions", "javascript-typescript", "python"].every(
        (language) => expected.filter((item) => item.language === language).length === 1,
      ) &&
      new Set(
        expected.map((item) => canonical([item.analysisKey, item.category, item.environment])),
      ).size === expected.length &&
      new Set(expected.map(canonical)).size === expected.length,
    "missing CodeQL registry",
  );
  const latest = [];
  for (const item of expected) {
    const group = analyses.filter(
      (a) =>
        a.analysis_key === item.analysisKey &&
        a.category === item.category &&
        a.environment === item.environment,
    );
    group.sort((a, b) => b.id - a.id);
    need(
      group.length && group[0].error === "" && !group[0].warning,
      "missing or incomplete CodeQL analysis",
    );
    latest.push(group[0].id);
  }
  const alerts = unique(await pages(get, `/code-scanning/alerts${query}`), "number");
  need(
    alerts.every(
      (a) =>
        a.tool.name === "CodeQL" &&
        a.most_recent_instance.ref === ref &&
        a.most_recent_instance.commit_sha === sha,
    ),
    "unbound CodeQL alert",
  );
  return { ids: alerts.map((a) => a.number), latest };
}
export async function codeqlEvidence(get, scope, merge, pins) {
  const base = await analyzedAlerts(get, "refs/heads/main", scope.base, pins);
  const head = await analyzedAlerts(get, `refs/pull/${scope.pr}/merge`, merge, pins);
  return {
    ...scope,
    complete: true,
    newAlerts: head.ids.filter((n) => !base.ids.includes(n)).length,
    analyses: { base: base.latest, head: head.latest },
  };
}
