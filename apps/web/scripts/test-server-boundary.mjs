import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// An isolated temporary route exercises Next's actual client/server compiler guard.
const directory = new URL(`../src/app/boundary-${crypto.randomUUID()}/`, import.meta.url);
const web = new URL("../", import.meta.url);
mkdirSync(directory);
try {
  writeFileSync(
    new URL("page.tsx", directory),
    '"use client";\nimport { getApiClient } from "../../api/server";\nexport default function Page() { return <p>{String(getApiClient)}</p>; }\n',
  );
  const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
    cwd: web,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, "Client import must fail the production build");
  assert.match(output, /server-only/);
  assert.match(output, /Client Component|Server Component/);
  console.log("Server-only compiler boundary: PASS (expected build rejection).");
} finally {
  // Only the unique route created above is removed; no user files or build artifacts.
  assert.ok(fileURLToPath(directory).startsWith(fileURLToPath(new URL("src/app/boundary-", web))));
  rmSync(directory, { recursive: true });
}
