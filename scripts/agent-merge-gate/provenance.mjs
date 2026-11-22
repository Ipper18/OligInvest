import { need, positive, repo } from "./evidence.mjs";
export function workflowFor(name) {
  if (name.startsWith("build (") || ["lint", "typecheck", "unit", "repository"].includes(name))
    return "ci";
  return { dast: "web", infrastructure: "infra", images: "release" }[name] ?? name;
}
export function jobKeyFor(name) {
  if (name.startsWith("build (")) return "build";
  return ["lint", "typecheck", "unit"].includes(name) ? "verify" : name;
}
export function proven(check, pins) {
  const workflow = workflowFor(check.name);
  const p = check.provenance;
  return Boolean(
    p &&
      pins &&
      positive(p.appId) &&
      p.appId === pins.actionsAppId &&
      positive(p.workflowId) &&
      p.workflowId === pins.workflows[workflow] &&
      p.workflowPath === `.github/workflows/${workflow}.yml` &&
      p.repo === repo &&
      p.event === "pull_request" &&
      p.jobName === check.name &&
      p.jobKey === jobKeyFor(check.name) &&
      [p.jobId, p.checkId, p.runId, p.attempt].every(positive),
  );
}
export function distinctJobs(checks) {
  for (const key of ["jobId", "checkId"]) {
    need(
      new Set(checks.map((c) => c.provenance[key])).size === checks.length,
      "ambiguous CI provenance",
    );
  }
}
