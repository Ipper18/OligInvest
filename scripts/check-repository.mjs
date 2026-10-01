import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkCommit(sha, subject) {
  return /^[a-f0-9]{40}$/.test(sha) && checkPullRequestTitle(subject);
}

export function checkFixturePaths(paths) {
  return paths.filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return /\.(xlsx|csv)$/i.test(normalized)
      && !/(^|\/)fixtures\/anonymized\//.test(normalized);
  });
}

export function checkPullRequestTitle(title) {
  return !/[\r\n]/.test(title)
    && /^(feat|fix|docs|refactor|perf|test|build|ci|chore)(\([a-z0-9,-]+\))?!?: [^\s\r\n][^\r\n]*$/.test(title);
}

function main() {
  let invalidCommits = false;
  const base = process.env.COMMIT_BASE_REF;
  const head = process.env.COMMIT_HEAD_REF;
  if (base || head) {
    if (![base, head].every((value) => /^[a-f0-9]{40}$/.test(value ?? ""))) {
      throw new Error("Commit range must use full Git SHAs");
    }
    const commits = execFileSync("git", ["log", "--format=%H%x00%s", `${base}..${head}`], { encoding: "utf8" }).trimEnd().split("\n").filter(Boolean);
    invalidCommits = commits.some((entry) => {
      const separator = entry.indexOf("\0");
      return separator < 0 || !checkCommit(entry.slice(0, separator), entry.slice(separator + 1));
    });
    if (invalidCommits) console.error("Commity muszą być zgodne z Conventional Commits.");
  }
  const paths = execFileSync("git", ["ls-files", "--cached", "-z"], {
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  const invalidPaths = checkFixturePaths(paths);
  for (const path of invalidPaths) {
    console.error(`Niedozwolona lokalizacja pliku danych: ${JSON.stringify(path)}`);
  }
  const titleRequired = process.env.GITHUB_EVENT_NAME === "pull_request";
  const title = process.env.PR_TITLE;
  const invalidTitle = (titleRequired || Boolean(title))
    && !checkPullRequestTitle(title ?? "");
  if (invalidTitle) {
    // Do not echo untrusted PR text or interpolate it into shell commands.
    console.error("Tytuł PR musi być zgodny z Conventional Commits.");
  }
  if (invalidPaths.length > 0 || invalidTitle || invalidCommits) {
    process.exitCode = 1;
  } else {
    console.log("Kontrola fixtures, tytułu PR i przekazanego zakresu commitów: OK.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
