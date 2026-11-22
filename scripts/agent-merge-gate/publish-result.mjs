import { need, positive, repo } from "./evidence.mjs";
import { apiRoot } from "./github.mjs";

// The isolated publisher exchanges its own App JWT for a token restricted to this repository.
// Only the trial context is published; never install this diagnostic name as a required check.
export async function publishResult({
  evaluate,
  reassess,
  pr,
  enabled = false,
  appId,
  installationId,
  appJwt,
  http = fetch,
}) {
  if (enabled !== true) return { published: false };
  need(positive(appId) && positive(installationId) && positive(pr), "missing publisher identity");
  async function request(url, token, method = "GET", body) {
    const response = await http(url, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: body && JSON.stringify(body),
    });
    need(response.ok, `publisher HTTP ${response.status}`);
    return response.json();
  }
  const identity = await request("https://api.github.com/app", appJwt);
  const installation = await request(`https://api.github.com/repos/${repo}/installation`, appJwt);
  need(
    identity.id === appId && installation.id === installationId && installation.app_id === appId,
    "wrong publisher",
  );
  const credentials = await request(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    appJwt,
    "POST",
    { repositories: ["OligInvest"], permissions: { checks: "write" } },
  );
  need(
    credentials.token &&
      credentials.permissions?.checks === "write" &&
      Object.entries(credentials.permissions).every(
        ([k, v]) => k === "checks" || (k === "metadata" && v === "read"),
      ),
    "excess token permissions",
  );
  const result = await evaluate(pr);
  const fresh = result.scope;
  need(fresh.pr === pr && fresh.repo === repo, "invalid publication target");
  const decision = await reassess(result);
  need(
    decision.reason !== "stale-snapshot" && decision.reason !== "changed-pr-state",
    "stale publication",
  );
  const check = await request(`${apiRoot}/check-runs`, credentials.token, "POST", {
    name: "agent-merge-gate/trial",
    head_sha: fresh.head,
    status: "completed",
    conclusion: decision.eligible && result.decision.eligible ? "success" : "failure",
    external_id: fresh.generation,
    output: {
      title: "Próba odbiorcza",
      summary: `Generacja ${fresh.generation}. Scalenie pozostaje ręczne.`,
    },
  });
  need(
    check.app.id === appId && check.head_sha === fresh.head && positive(check.id),
    "publication mismatch",
  );
  return { published: true, checkId: check.id, mergeAllowed: false };
}
