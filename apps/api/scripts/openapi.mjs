import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPending,
  generateDocument,
  operations,
  pendingOperations,
  readBasePending,
  readSource,
} from "./openapi-contract.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pendingPath = join(root, "apps/api/openapi-pending.json");
try {
  const mode = process.argv[2];
  if (!["check", "pending"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node apps/api/scripts/openapi.mjs check|pending");
  }
  const source = readSource(root);
  const generated = await generateDocument();
  const expected = pendingOperations(source, generated);
  const baseRef = process.env.OPENAPI_BASE_REF || "origin/main";
  const base = readBasePending(root, baseRef);
  // Generating the file cannot bypass the monotonicity check either.
  assertPending(
    source,
    generated,
    mode === "pending" ? expected : JSON.parse(readFileSync(pendingPath, "utf8")),
    base,
  );
  if (mode === "pending") writeFileSync(pendingPath, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(
    `OpenAPI: ${operations(generated).size} implemented, ${expected.length} pending; base ${baseRef}; OK (${mode}).`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
