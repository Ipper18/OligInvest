import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_READ_TABLES } from "@oliginvest/mod-admin/server";
import { expect, test } from "vitest";

// BL-112 (FR-08.01): administrator views read account data only. Domain schemas hold portfolio,
// transaction, analysis, alert and preference data; no admin read model may name them. The
// PostgreSQL integration test (apps/api/integration/admin-users.mjs) proves it at runtime.
const DOMAIN_SCHEMAS = /\b(portfolio|analytics|alerts|market|education|notifications)\.[a-z_]+/giu;
const source = fileURLToPath(new URL("../src/server/users.ts", import.meta.url));

test("admin read models name no domain schema and only the declared account tables", () => {
  const text = readFileSync(source, "utf8");
  expect(text.match(DOMAIN_SCHEMAS) ?? []).toEqual([]);
  const named = new Set(
    [...text.matchAll(/\b(auth|identity|platform)\.([a-z_]+)/gu)].map((match) => match[0]),
  );
  expect([...named].sort()).toEqual([...ADMIN_READ_TABLES].sort());
});

test("no other admin server file reads user financial tables", () => {
  const dir = fileURLToPath(new URL("../src/server/", import.meta.url));
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    // The stress-scenario editor writes reference data (analytics.stress_scenarios), never user data.
    const hits = (text.match(DOMAIN_SCHEMAS) ?? []).filter(
      (hit) => hit.toLowerCase() !== "analytics.stress_scenarios",
    );
    expect({ file, hits }).toEqual({ file, hits: [] });
  }
});
