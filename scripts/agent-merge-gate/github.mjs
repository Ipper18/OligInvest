import { need, positive, repo, requiredEnv } from "./evidence.mjs";
export const apiRoot = `https://api.github.com/repos/${repo}`;
export function githubReader(token = requiredEnv("GATE_COLLECTOR_TOKEN"), http = fetch) {
  need(token, "collector installation token required");
  return async (path) => {
    need(
      /^\/[a-z0-9]/i.test(path) && new URL(apiRoot + path).href.startsWith(`${apiRoot}/`),
      "invalid API path",
    );
    const response = await http(apiRoot + path, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    need(response.ok, `GitHub read failed: ${response.status}`);
    return response.json();
  };
}
// Explicit page numbers keep the credential on the pinned repository origin.
export async function pages(get, path, field) {
  const rows = [];
  let total;
  for (let page = 1; page <= 100; page++) {
    const result = await get(`${path + (path.includes("?") ? "&" : "?")}per_page=100&page=${page}`);
    const batch = field ? result[field] : result;
    need(Array.isArray(batch) && batch.length <= 100, "invalid GitHub page");
    if (field) {
      need(
        Number.isSafeInteger(result.total_count) &&
          (total === undefined || total === result.total_count),
        "list changed",
      );
      total = result.total_count;
      if (field === "workflow_runs") need(total < 1000, "workflow search limit reached");
    }
    rows.push(...batch);
    if (batch.length < 100) {
      need(total === undefined || rows.length === total, "incomplete GitHub list");
      return rows;
    }
  }
  throw new Error("pagination limit");
}
export function unique(rows, key) {
  need(
    rows.every((r) => positive(r[key])) && new Set(rows.map((r) => r[key])).size === rows.length,
    "invalid or duplicate identifiers",
  );
  return rows;
}
