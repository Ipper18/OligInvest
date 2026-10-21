import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const path = new URL("apps/api/src/modules.ts", root);
const start = "// BEGIN OPTIONAL EDUCATION";
const end = "// END OPTIONAL EDUCATION";
const block = existsSync(new URL("modules/education/package.json", root))
  ? 'export { mountEducation } from "@oliginvest/mod-education/server";'
  : "export function mountEducation(_api: unknown, _dependencies: unknown): void {}";
const original = readFileSync(path, "utf8");
const source = original.replace(new RegExp(`${start}[\\s\\S]*?${end}\\r?\\n?`), "").trim();
const result = `${start}\n${block}\n${end}\n\n${source}\n`;
if (result !== original) writeFileSync(path, result);
