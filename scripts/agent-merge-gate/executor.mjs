import { need, positive, repo, sameScope } from "./evidence.mjs";

// This module has no process, network or GitHub mutation capability.
export function planMerge(result, current, enabled = false) {
  if (
    enabled !== true ||
    result.decision.eligible !== true ||
    result.decision.mergeAllowed !== false ||
    !sameScope(result.scope, current) ||
    current.repo !== repo ||
    !positive(current.pr) ||
    !/^[0-9a-f]{40}$/.test(current.head) ||
    current.mergeState !== "CLEAN" ||
    current.draft !== false ||
    current.state !== "OPEN"
  )
    return { mergeAllowed: false, argv: null };
  return {
    mergeAllowed: false,
    argv: [
      "gh",
      "pr",
      "merge",
      String(current.pr),
      "--repo",
      repo,
      "--auto",
      "--squash",
      "--match-head-commit",
      current.head,
    ],
  };
}
export function shutdownPlan(pendingPrs, publishedRuns) {
  need([...pendingPrs, ...publishedRuns].every(positive), "invalid rollback inventory");
  return {
    dryRun: true,
    steps: [
      { operation: "stop-executor" },
      ...pendingPrs.map((pr) => ({ operation: "cancel-auto-merge", repo, pr })),
      ...publishedRuns.map((checkId) => ({
        operation: "invalidate-check",
        repo,
        checkId,
        conclusion: "failure",
      })),
      { operation: "rotate-generation-and-verify-inventory" },
    ],
  };
}
