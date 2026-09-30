import { gzipSync } from "node:zlib";
import {
  fetchChecked,
  isMain,
  readJson,
  report,
  withPerformanceServer,
} from "./performance-server.mjs";

const MARKERS = {
  "lightweight-charts": (code) => /lightweight-charts|TradingView, Inc\./i.test(code),
  uplot: (code) => /u-over|u-under/.test(code),
  "driver.js": (code) => /driver-popover|driver-active/.test(code),
  radix: (code) => /data-radix-|radix-ui/.test(code),
  query: (code) => code.includes("queryHash") && code.includes("queryKey"),
  zod: (code) =>
    /ZodError|ZodObject/.test(code) ||
    (code.includes("invalid_type") && code.includes("unrecognized_keys")),
};
export const gzipBytes = (buffer) => gzipSync(buffer, { level: 9 }).length;
export function scriptSources(html, noModule = false) {
  const sources = new Set();
  for (const match of html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi)) {
    const attributes = new Map(
      [...match[1].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(
        (attr) => [attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? ""],
      ),
    );
    if (attributes.has("nomodule") !== noModule || !attributes.has("src")) continue;
    sources.add(attributes.get("src").replaceAll("&amp;", "&"));
  }
  return [...sources];
}
function matches(route, pattern) {
  const parts = pattern
    .split("/")
    .map((part) =>
      part === "*"
        ? ".+"
        : /^\[\w+\]$/.test(part)
          ? "[^/]+"
          : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  return new RegExp(`^${parts.join("/")}$`).test(route);
}
export function matchBudget(route, config) {
  return (
    config.routes[route] ??
    Object.entries(config.routes).find(([pattern]) => matches(route, pattern))?.[1]
  );
}
export function planRoutes(manifest, config, fixtures = {}) {
  for (const value of Object.values(fixtures)) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw new Error("Invalid fixture identifier");
  }
  const routes = [];
  for (const path of Object.keys(manifest)) {
    if (!path.endsWith("/page")) continue;
    const segments = path.split("/").filter((part) => part && !/^\(.*\)$/.test(part));
    if (segments.some((part) => part.startsWith("_"))) continue;
    const route = `/${segments.slice(0, -1).join("/")}`.replace(/\[(\w+)\]/g, (_, key) => {
      if (!fixtures[key]) throw new Error(`Missing performance fixture: ${key}`);
      return fixtures[key];
    });
    if (route.includes("["))
      throw new Error("Unsupported dynamic route: add a performance fixture adapter");
    const budget = matchBudget(route, config);
    if (!budget) throw new Error(`Missing route budget: ${route}`);
    if (!routes.some((entry) => entry.route === route)) routes.push({ route, budget });
  }
  if (!routes.length) throw new Error("No routes in production manifest");
  return {
    routes,
    pending: Object.keys(config.routes).filter(
      (pattern) => !routes.some(({ route }) => matches(route, pattern)),
    ),
  };
}
export function assessRoute(chunks, budget) {
  if (!chunks.length) throw new Error("No initial scripts found");
  const bytes = chunks.reduce((sum, code) => sum + gzipBytes(code), 0);
  const forbidden = [];
  for (const family of budget.forbid) {
    const names = family === "charts" ? ["lightweight-charts", "uplot"] : [family];
    if (
      names.some((name) => {
        if (!MARKERS[name]) throw new Error(`Unknown library marker: ${name}`);
        return chunks.some((code) => MARKERS[name](Buffer.from(code).toString()));
      })
    )
      forbidden.push(family);
  }
  return {
    bytes,
    forbidden,
    failed: bytes > budget.initialKb * 1024 || bytes >= 200 * 1024 || forbidden.length > 0,
  };
}
export function currentPlan() {
  const config = readJson("budgets.json");
  if (config.compression !== "gzip-9") throw new Error("Expected gzip-9");
  return planRoutes(
    readJson(".next/server/app-paths-manifest.json"),
    config,
    JSON.parse(process.env.PERF_FIXTURES || "{}"),
  );
}
export async function measureRoute(origin, route, budget) {
  const url = new URL(route, origin);
  const html = await (await fetchChecked(url, { cookie: process.env.LH_SESSION_COOKIE })).text();
  const sources = scriptSources(html);
  const chunks = await Promise.all(
    sources.map(async (source) => {
      const asset = new URL(source, url);
      if (
        asset.origin !== url.origin ||
        !asset.pathname.startsWith("/_next/static/") ||
        !asset.pathname.endsWith(".js")
      )
        throw new Error("Unexpected initial script source");
      return Buffer.from(await (await fetchChecked(asset, { type: "javascript" })).arrayBuffer());
    }),
  );
  return {
    route,
    sources,
    chunks,
    noModule: scriptSources(html, true),
    ...assessRoute(chunks, budget),
  };
}
export async function main() {
  const plan = currentPlan();
  const results = await withPerformanceServer(async (origin) => {
    const rows = [];
    for (const { route, budget } of plan.routes)
      rows.push({ ...(await measureRoute(origin, route, budget)), budget });
    return rows;
  });
  report(
    [
      "### Budżety JS (gzip -9, KiB)",
      "",
      "| Trasa | Początkowy / limit | Zakazane | Wynik |",
      "|---|---:|---|---|",
      ...results.map(
        (row) =>
          `| ${row.route} | ${(row.bytes / 1024).toFixed(2)} / ${row.budget.initialKb} | ${row.forbidden.join(", ") || "brak"} | ${row.failed ? "FAIL" : "PASS"} |`,
      ),
      "",
      `OCZEKUJE na implementację: ${plan.pending.join(", ")}.`,
      "Leniwe / razem: niezmierzone (wymagają scenariuszy interakcji).",
    ].join("\n"),
  );
  process.exitCode = results.some((row) => row.failed) ? 1 : 0;
}
if (isMain(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
