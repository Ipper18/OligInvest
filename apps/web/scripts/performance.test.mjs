import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { assessLighthouse, lighthouseExitCode } from "./lighthouse-assert.mjs";
import { fetchChecked, webDirectory } from "./performance-server.mjs";
import { assessRoute, matchBudget, planRoutes, scriptSources } from "./route-budgets.mjs";

const budgets = JSON.parse(readFileSync(new URL("../budgets.json", import.meta.url)));

test("measurement rejects redirects, missing routes and invalid response types", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") return response.writeHead(302, { Location: "/login" }).end();
    if (request.url === "/missing") return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    for (const path of ["/redirect", "/missing", "/json"]) {
      await assert.rejects(
        fetchChecked(`http://127.0.0.1:${server.address().port}${path}`),
        /Invalid performance response/,
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise((accept) => server.close(accept));
  }
});

test("Zod marker detects the installed minified library, with no dependency on its filename", async () => {
  const result = await build({
    stdin: {
      contents:
        'import * as z from "zod"; export const schema = z.object({name:z.string()}).strict();',
      resolveDir: webDirectory,
    },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
  });
  assert.deepEqual(
    assessRoute([result.outputFiles[0].contents], { initialKb: 190, forbid: ["zod"] }).forbidden,
    ["zod"],
  );
});

test("HTML scripts: deduplicate, exclude noModule/preload/inline, decode query strings", () => {
  assert.deepEqual(
    scriptSources(`<script src="/a.js?a=1&amp;b=2"></script>
    <script nomodule src='/old.js'></script><script src="/a.js?a=1&amp;b=2"></script>
    <link rel="preload" href="/prefetch.js"><script>self.__next_f.push([])</script>
    <script async src=/b.js></script>`),
    ["/a.js?a=1&b=2", "/b.js"],
  );
});

test("route matching uses segment boundaries and specific routes before dynamic ones", () => {
  assert.equal(matchBudget("/portfel/operacje", budgets).initialKb, 195);
  assert.equal(matchBudget("/rynek/screener", budgets).initialKb, 195);
  assert.equal(matchBudget("/rynek/fixture", budgets).initialKb, 190);
  assert.equal(matchBudget("/portfel-unknown", budgets), undefined);
  assert.equal(matchBudget("/unknown", budgets), undefined);
});

test("manifest coverage: no silent omissions; dynamic fixtures are mandatory", () => {
  assert.throws(() => planRoutes({ "/unknown/page": "x" }, budgets), /budget/i);
  assert.throws(() => planRoutes({ "/rynek/[instrumentId]/page": "x" }, budgets), /fixture/i);
  const plan = planRoutes(
    { "/(app)/page": "x", "/_not-found/page": "x", "/rynek/[instrumentId]/page": "x" },
    budgets,
    { instrumentId: "synthetic" },
  );
  assert.deepEqual(
    plan.routes.map((entry) => entry.route),
    ["/", "/rynek/synthetic"],
  );
  assert.ok(plan.pending.includes("/portfel"));
  assert.throws(
    () => planRoutes({ "/page": "x" }, budgets, { instrumentId: "../bad" }),
    /fixture/i,
  );
});

test("route budget uses gzip-9 and rejects a byte above its limit, including global 200 KiB", () => {
  const code = Buffer.from("const value = 'test';");
  const bytes = gzipSync(code, { level: 9 }).length;
  assert.equal(assessRoute([code], { initialKb: bytes / 1024, forbid: [] }).failed, false);
  assert.equal(assessRoute([code], { initialKb: (bytes - 1) / 1024, forbid: [] }).failed, true);
  const many = Array.from({ length: Math.ceil((200 * 1024) / bytes) }, () => code);
  assert.equal(assessRoute(many, { initialKb: 300, forbid: [] }).failed, true);
});

test("all forbidden library families survive representative minified markers", () => {
  for (const [family, code] of Object.entries({
    "lightweight-charts": 'x="TradingView, Inc."',
    uplot: 'x.className="u-over"',
    "driver.js": 'x.className="driver-popover"',
    radix: 'x["data-radix-popper-content-wrapper"]',
    query: "x.queryHash=x.queryKey",
    zod: 'x=["invalid_type","unrecognized_keys"]',
  })) {
    assert.deepEqual(
      assessRoute([Buffer.from(code)], { initialKb: 190, forbid: [family] }).forbidden,
      [family],
    );
  }
  assert.equal(
    assessRoute([Buffer.from('x="u-under"')], { initialKb: 190, forbid: ["charts"] }).failed,
    true,
  );
  assert.throws(() => assessRoute([], { initialKb: 190, forbid: [] }), /scripts/i);
  assert.throws(
    () => assessRoute([Buffer.from("")], { initialKb: 190, forbid: ["typo"] }),
    /marker/i,
  );
});

const lhr = (lcp = 1000, tbt = 50, cls = 0.01) => ({
  finalDisplayedUrl: "http://localhost/",
  audits: {
    "largest-contentful-paint": { numericValue: lcp },
    "total-blocking-time": { numericValue: tbt },
    "cumulative-layout-shift": { numericValue: cls },
  },
});

test("Lighthouse uses three medians and strict thresholds; M0 only reports breaches", () => {
  const passing = assessLighthouse([lhr(5000), lhr(), lhr()], "http://localhost/");
  assert.equal(passing.failed, false);
  const failing = assessLighthouse(
    [lhr(), lhr(2000, 200, 0.1), lhr(9000, 900, 0.9)],
    "http://localhost/",
  );
  assert.equal(failing.failed, true);
  assert.deepEqual(
    failing.metrics.map((metric) => metric.median),
    [2000, 200, 0.1],
  );
  assert.equal(lighthouseExitCode([failing], false), 0);
  assert.equal(lighthouseExitCode([failing], true), 1);
});

test("Lighthouse rejects absent, nonfinite, errored or redirected results even in report mode", () => {
  for (const invalid of [
    lhr(Number.NaN),
    lhr(-1),
    {},
    { ...lhr(), runtimeError: { code: "FAILED" } },
    { ...lhr(), finalDisplayedUrl: "http://localhost/logowanie" },
  ]) {
    assert.throws(() => assessLighthouse([invalid, lhr(), lhr()], "http://localhost/"));
  }
  assert.throws(() => assessLighthouse([lhr()], "http://localhost/"));
});
