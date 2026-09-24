import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkFixturePaths(paths) {
  return paths.filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    return /\.(xlsx|csv)$/i.test(normalized)
      && !/(^|\/)fixtures\/anonymized\//.test(normalized);
  });
}

export function checkPullRequestTitle(title) {
  return !/[\r\n]/.test(title)
    && /^(feat|fix|docs|refactor|perf|test|build|ci|chore)(\([a-z0-9-]+\))?!?: [^\s\r\n][^\r\n]*$/.test(title);
}

function main() {
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
  if (invalidPaths.length > 0 || invalidTitle) {
    process.exitCode = 1;
  } else {
    console.log("Kontrola ścieżek fixtures i przekazanego tytułu PR: OK.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
