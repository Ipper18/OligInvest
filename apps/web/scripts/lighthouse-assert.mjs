import { existsSync } from "node:fs";
import { fetchChecked, isMain, report, withPerformanceServer } from "./performance-server.mjs";
import { currentPlan } from "./route-budgets.mjs";

const LIMITS = {
  "largest-contentful-paint": 2000,
  "total-blocking-time": 200,
  "cumulative-layout-shift": 0.1,
};
let phase = "configuration";
const failure = (code) => Object.assign(new Error(code), { code });
export function diagnosticCode(error) {
  return typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}
export function assessLighthouse(runs, expectedUrl) {
  if (runs.length !== 3) throw failure("LH_REQUIRES_THREE_RUNS");
  for (const run of runs) {
    if (run.runtimeError) throw failure(`LH_RUNTIME_${diagnosticCode(run.runtimeError)}`);
    if ((run.finalDisplayedUrl ?? run.finalUrl) !== expectedUrl)
      throw failure("LH_NAVIGATION_MISMATCH");
  }
  const metrics = Object.entries(LIMITS).map(([audit, limit]) => {
    const values = runs.map((run) => run.audits?.[audit]?.numericValue);
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      throw failure(`LH_INVALID_${audit.replaceAll("-", "_").toUpperCase()}`);
    const median = values.sort((a, b) => a - b)[1];
    return { audit, limit, median, failed: median >= limit };
  });
  return { metrics, failed: metrics.some((metric) => metric.failed) };
}
export const lighthouseExitCode = (results, enforce) =>
  enforce && results.some((row) => row.failed) ? 1 : 0;

export async function main() {
  const enforce = process.argv.includes("--assert");
  const plan = currentPlan();
  const fixtures = JSON.parse(process.env.PERF_FIXTURES || "{}");
  const wanted = [
    "/logowanie",
    "/",
    "/portfel",
    `/rynek/${fixtures.instrumentId ?? "[instrumentId]"}`,
  ];
  const routes = wanted.filter((route) => plan.routes.some((entry) => entry.route === route));
  const pending = wanted.filter((route) => !routes.includes(route));
  if (!routes.length || (enforce && pending.length)) throw failure("LH_REQUIRED_ROUTES_MISSING");
  const [{ default: lighthouse }, { launch }, { chromium }] = await Promise.all([
    import("lighthouse"),
    import("chrome-launcher"),
    import("@playwright/test"),
  ]);
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  if (!existsSync(chromePath)) throw failure("LH_CHROME_PATH_MISSING");
  phase = "next-start";
  const results = await withPerformanceServer(async (origin) => {
    phase = "chrome-launch";
    const chrome = await launch({
      chromePath,
      chromeFlags: ["--headless=new"],
      // Startup diagnostics concern an empty, isolated profile, before any cookie is supplied.
      logLevel: "error",
    });
    try {
      phase = "audit";
      const rows = [];
      for (const route of routes) {
        const url = new URL(route, origin).href;
        await fetchChecked(url, { cookie: process.env.LH_SESSION_COOKIE });
        const runs = [];
        for (let iteration = 0; iteration < 3; iteration++) {
          const result = await lighthouse(url, {
            port: chrome.port,
            output: "json",
            onlyCategories: ["performance"],
            logLevel: "error",
            formFactor: "mobile",
            throttlingMethod: "simulate",
            extraHeaders: process.env.LH_SESSION_COOKIE
              ? { Cookie: process.env.LH_SESSION_COOKIE }
              : {},
          });
          if (!result?.lhr) throw failure("LH_NO_REPORT");
          runs.push(result.lhr);
        }
        phase = "assessment";
        rows.push({ route, ...assessLighthouse(runs, url) });
        phase = "audit";
      }
      return rows;
    } finally {
      await chrome.kill();
    }
  });
  report(
    [
      `### Lighthouse 13.5 — ${enforce ? "asercje M1" : "raport M0"}`,
      "",
      "Profil mobilny, symulowane dławienie, mediana z 3 przebiegów.",
      "",
      "| Trasa | Audyt | Mediana | Próg (<) | Wynik |",
      "|---|---|---:|---:|---|",
      ...results.flatMap((row) =>
        row.metrics.map(
          (metric) =>
            `| ${row.route} | ${metric.audit} | ${metric.median.toFixed(3)} | ${metric.limit} | ${metric.failed ? "FAIL" : "PASS"} |`,
        ),
      ),
      "",
      `OCZEKUJE na implementację: ${pending.join(", ") || "brak"}.`,
    ].join("\n"),
  );
  process.exitCode = lighthouseExitCode(results, enforce);
}
if (isMain(import.meta.url))
  main().catch((error) => {
    console.error(
      `Lighthouse measurement failed: ${phase}/${diagnosticCode(error)} (headers and report suppressed).`,
    );
    process.exitCode = 1;
  });
