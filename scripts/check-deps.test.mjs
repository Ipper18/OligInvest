import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { checkDependencies } from "./check-deps.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oliginvest-deps-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, value) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  }
  function pkg(path, dependencies = {}, extra = {}) {
    const [group, id] = path.split("/");
    const name = `@oliginvest/${group === "modules" ? "mod-" : ""}${id}`;
    write(`${path}/package.json`, {
      name,
      dependencies,
      exports:
        group === "modules"
          ? Object.fromEntries(
              ["contracts", "server", "jobs", "ui"].map((key) => [`./${key}`, `./dist/${key}.js`]),
            )
          : { ".": "./dist/index.js" },
      ...extra,
    });
    return name;
  }
  const identity = pkg("modules/identity");
  const market = pkg("modules/market", { [identity]: "workspace:*" });
  const alerts = pkg("modules/alerts", { [market]: "workspace:*" });
  const analytics = pkg("modules/analytics", { [market]: "workspace:*" });
  const db = pkg("packages/db");
  pkg("packages/core", { "decimal.js": "10.6.0" });
  pkg("apps/web", { [alerts]: "workspace:*" });
  return { root, write, pkg, identity, market, alerts, analytics, db };
}

test("accepts layers, public services, local imports and web UI composition", (t) => {
  const f = fixture(t);
  f.write(
    "modules/analytics/src/index.ts",
    `export * from '${f.market}/server';\nimport './local.js';`,
  );
  f.write("modules/analytics/src/local.ts", "export {};\n");
  f.write("apps/web/src/modules.ts", `import '${f.alerts}/ui';`);
  f.write("apps/web/app/alerts/page.tsx", `export { default } from '${f.alerts}/ui';`);
  assert.deepEqual(checkDependencies(f.root), []);
});

for (const section of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  test(`rejects a feature dependency in ${section}`, (t) => {
    const f = fixture(t);
    f.pkg("modules/analytics", {}, { [section]: { [f.alerts]: "workspace:*" } });
    assert.match(checkDependencies(f.root).join("\n"), /layer/);
  });
}

for (const source of [
  "import { x } from '@oliginvest/mod-alerts/contracts';",
  "export * from '@oliginvest/mod-alerts/contracts';",
  "import type { X } from '@oliginvest/mod-alerts/contracts';",
  "type X = import('@oliginvest/mod-alerts/contracts').X;",
  "const x = import(`@oliginvest/mod-alerts/contracts`);",
  "const x = require('@oliginvest/mod-alerts/contracts');",
  "import x = require('@oliginvest/mod-alerts/contracts');",
]) {
  test(`rejects forbidden source dependency: ${source}`, (t) => {
    const f = fixture(t);
    f.write("modules/analytics/src/index.ts", source);
    assert.match(checkDependencies(f.root).join("\n"), /layer/);
  });
}

for (const [path, source, error] of [
  [
    "modules/analytics/src/index.ts",
    "import '@oliginvest/mod-market/src/private';",
    /public export/,
  ],
  ["modules/analytics/src/index.ts", "import '@oliginvest/mod-market/jobs';", /feature entry/],
  [
    "modules/analytics/src/index.ts",
    "import '../../alerts/src/contracts.js';",
    /relative boundary/,
  ],
  ["modules/analytics/src/index.ts", "import('/tmp/foreign.js');", /absolute/],
  ["modules/analytics/src/index.ts", "import(name);", /literal/],
  ["modules/analytics/src/index.ts", `import(\`@oliginvest/mod-\${name}/contracts\`);`, /literal/],
  ["modules/analytics/src/index.ts", "import '#hidden';", /undeclared/],
  ["modules/analytics/src/index.ts", "import '@oliginvest/mod-identity/contracts';", /undeclared/],
  ["apps/web/src/modules.ts", "import '@oliginvest/mod-alerts/server';", /web/],
  ["apps/web/src/modules.ts", "import '@oliginvest/mod-alerts/jobs';", /web/],
  ["apps/web/src/page.ts", "import '@oliginvest/mod-alerts/ui';", /composition/],
  ["packages/core/src/index.ts", "import 'node:fs';", /core/],
]) {
  test(`rejects ${source} in ${path}`, (t) => {
    const f = fixture(t);
    f.write(path, source);
    assert.match(checkDependencies(f.root).join("\n"), error);
  });
}

test("rejects inverted layers, apps as dependencies, web DB and workspace cycles", (t) => {
  const f = fixture(t);
  f.pkg("modules/identity", { [f.market]: "workspace:*" });
  f.pkg("packages/db", { [f.identity]: "workspace:*" });
  f.pkg("packages/core", { "@oliginvest/web": "workspace:*" });
  f.pkg("apps/web", { [f.db]: "workspace:*" });
  const errors = checkDependencies(f.root).join("\n");
  for (const pattern of [/layer/, /core/, /web/, /cycle/]) assert.match(errors, pattern);
});

test("rejects expanded module exports and missing workspace packages", (t) => {
  const f = fixture(t);
  f.pkg(
    "modules/alerts",
    { "@oliginvest/missing": "workspace:*" },
    { exports: { "./*": "./dist/*.js" } },
  );
  assert.match(checkDependencies(f.root).join("\n"), /module exports/);
  assert.match(checkDependencies(f.root).join("\n"), /unknown workspace/);
});

test("ignores comments, strings and tooling fixtures, but scans TSX and JS", (t) => {
  const f = fixture(t);
  f.write(
    "modules/analytics/src/index.ts",
    `// import '${f.alerts}/server';\nconst example = "import('${f.alerts}/server')";`,
  );
  f.write("packages/db/test/schema.test.mjs", `import '${f.alerts}/server';`);
  assert.deepEqual(checkDependencies(f.root), []);
  for (const ext of ["tsx", "js", "mjs", "cts"])
    f.write(`modules/analytics/src/bad.${ext}`, `import '${f.alerts}/contracts';`);
  assert.equal(checkDependencies(f.root).filter((error) => error.includes("layer")).length, 4);
});

test("CLI exits nonzero for a forbidden import (M0 negative test)", (t) => {
  const f = fixture(t);
  f.write("modules/analytics/src/forbidden.ts", `import '${f.alerts}/contracts';`);
  const run = spawnSync(process.execPath, [resolve("scripts/check-deps.mjs")], {
    cwd: f.root,
    encoding: "utf8",
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /forbidden.ts.*layer/);
});
