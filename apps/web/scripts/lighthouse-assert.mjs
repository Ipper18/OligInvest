import { existsSync } from "node:fs";
import {
  fetchChecked,
  fixtureCookie,
  isMain,
  report,
  withPerformanceServer,
} from "./performance-server.mjs";
import { localChromeFlags } from "./performance-tls.mjs";
import { currentPlan, performanceFixtures } from "./route-budgets.mjs";

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

/** "a=1; b=2" → CDP cookie params for a secure origin (host-only, Path=/, as __Host- requires). */
export function browserCookies(header, origin) {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 1) throw failure("LH_COOKIE_INVALID");
      return {
        name: part.slice(0, index),
        value: part.slice(index + 1),
        url: `${origin}/`,
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      };
    });
}

// The fixture session goes into the browser's cookie jar, like a real login. A CDP `Cookie`
// extra header is replaced by Chrome as soon as the jar holds any cookie for the origin
// (e.g. the non-sensitive `oi-locale` set by BL-211), which silently drops the session.
// Lighthouse keeps cookies between runs, so each route starts from a cleared jar.
async function applyRouteCookies(port, origin, header) {
  const version = await (
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })
  ).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((accept, reject) => {
    socket.addEventListener("open", accept, { once: true });
    socket.addEventListener("error", () => reject(failure("LH_CDP_UNAVAILABLE")), { once: true });
  });
  let id = 0;
  const send = (method, params = {}) =>
    new Promise((accept, reject) => {
      const current = ++id;
      const listener = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== current) return;
        socket.removeEventListener("message", listener);
        if (message.error) reject(failure("LH_CDP_COOKIE_FAILED"));
        else accept(message.result);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id: current, method, params }));
    });
  try {
    await send("Storage.clearCookies");
    const cookies = browserCookies(header, origin);
    if (cookies.length) await send("Storage.setCookies", { cookies });
  } finally {
    socket.close();
  }
}

export async function main() {
  const fullGate = process.argv.includes("--assert");
  const enforce = fullGate || process.argv.includes("--assert-available");
  const plan = currentPlan();
  const fixtures = performanceFixtures();
  const wanted = [
    "/logowanie",
    "/",
    "/portfel",
    `/rynek/${fixtures.instrumentId ?? "[instrumentId]"}`,
  ];
  const routes = wanted.filter((route) => plan.routes.some((entry) => entry.route === route));
  const pending = wanted.filter((route) => !routes.includes(route));
  if (!routes.length || (fullGate && pending.length)) throw failure("LH_REQUIRED_ROUTES_MISSING");
  const [{ default: lighthouse }, { launch }, { chromium }] = await Promise.all([
    import("lighthouse"),
    import("chrome-launcher"),
    import("@playwright/test"),
  ]);
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  if (process.env.CI && !process.env.CHROME_PATH) throw failure("LH_SYSTEM_CHROME_REQUIRED");
  if (!existsSync(chromePath)) throw failure("LH_CHROME_PATH_MISSING");
  phase = "next-start";
  const results = await withPerformanceServer(async (origin) => {
    phase = "chrome-launch";
    const chrome = await launch({
      chromePath,
      chromeFlags: ["--headless=new", ...localChromeFlags()],
      // Startup diagnostics concern an empty, isolated profile, before any cookie is supplied.
      logLevel: "error",
    });
    try {
      const version = await (
        await fetch(`http://127.0.0.1:${chrome.port}/json/version`, {
          signal: AbortSignal.timeout(5000),
        })
      ).json();
      if (!/^(?:HeadlessChrome|Chrome)\/[0-9.]+$/.test(version.Browser ?? ""))
        throw failure("LH_CHROME_VERSION_INVALID");
      console.log(
        `Lighthouse browser: ${version.Browser}; sandbox enabled; ${process.env.CHROME_PATH ? "CHROME_PATH" : "Playwright executable"}.`,
      );
      phase = "audit";
      const rows = [];
      for (const route of routes) {
        const url = new URL(route, origin).href;
        await fetchChecked(url, { cookie: fixtureCookie(route) });
        await applyRouteCookies(chrome.port, new URL(url).origin, fixtureCookie(route));
        const runs = [];
        for (let iteration = 0; iteration < 3; iteration++) {
          const result = await lighthouse(url, {
            port: chrome.port,
            output: "json",
            onlyCategories: ["performance"],
            logLevel: "error",
            formFactor: "mobile",
            throttlingMethod: "simulate",
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
