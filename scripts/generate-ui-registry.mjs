import { existsSync, readFileSync, writeFileSync } from "node:fs";
import "./generate-education.mjs";

const root = new URL("../", import.meta.url);
// A module may ship its API before its screens; navigation must not lead to a 404 meanwhile.
const hasRoute = (href) => existsSync(new URL(`apps/web/src/app/(app)${href}/page.tsx`, root));
const definitions = [];
// These sources export only static UI metadata; type-only imports are stripped by Node.
for (const id of ["portfolio", "market", "alerts", "analytics", "education"]) {
  const file = new URL(`modules/${id}/src/ui-module.ts`, root);
  if (!existsSync(file)) continue;
  const definition = (await import(file.href)).uiDefinition;
  definitions.push(
    definition.nav
      ? { ...definition, nav: definition.nav.filter((item) => hasRoute(item.href)) }
      : definition,
  );
}
const output = new URL("apps/web/src/ui-modules.json", root),
  text = JSON.stringify(definitions, null, 2) + "\n";
if (
  !existsSync(output) ||
  JSON.stringify(JSON.parse(readFileSync(output, "utf8"))) !== JSON.stringify(definitions)
)
  writeFileSync(output, text);
