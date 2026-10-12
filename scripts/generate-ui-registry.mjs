import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const definitions = [];
// These sources export only static UI metadata; type-only imports are stripped by Node.
for (const id of ["portfolio", "market", "alerts", "analytics", "education"]) {
  const file = new URL(`modules/${id}/src/ui-module.ts`, root);
  if (existsSync(file)) definitions.push((await import(file.href)).uiDefinition);
}
const output = new URL("apps/web/src/ui-modules.json", root),
  text = JSON.stringify(definitions, null, 2) + "\n";
if (
  !existsSync(output) ||
  JSON.stringify(JSON.parse(readFileSync(output, "utf8"))) !== JSON.stringify(definitions)
)
  writeFileSync(output, text);
