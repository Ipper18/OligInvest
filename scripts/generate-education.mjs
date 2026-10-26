import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const directory = new URL("modules/education/content/", root);
const entries = existsSync(directory)
  ? readdirSync(directory)
      .filter((name) => name.endsWith(".mdx"))
      .sort()
      .map((name) => {
        const source = readFileSync(new URL(name, directory), "utf8");
        const match =
          /^export const metadata = (.+);\r?\n\r?\n## Definicja\r?\n([\s\S]+?)\r?\n\r?\n## Jak czytać\r?\n([\s\S]+?)\r?\n\r?\n## Pułapki\r?\n([\s\S]+?)\s*$/u.exec(
            source,
          );
        if (!match) throw new Error(`Invalid education content: ${name}`);
        const metadata = JSON.parse(match[1]);
        if (
          !/^[a-z0-9-]+$/.test(metadata.key) ||
          metadata.key !== name.replace(/\.mdx$/, "") ||
          typeof metadata.term !== "string" ||
          !Array.isArray(metadata.synonyms) ||
          !metadata.synonyms.every((value) => typeof value === "string") ||
          typeof metadata.formula !== "string" ||
          !metadata.href?.startsWith("/")
        )
          throw new Error(`Invalid education metadata: ${name}`);
        return {
          ...metadata,
          definition: match[2].trim(),
          reading: match[3].trim(),
          pitfalls: match[4].trim(),
        };
      })
  : [];
const output = new URL("apps/web/src/education/content.json", root);
const text = `${JSON.stringify(entries, null, 2)}\n`;
if (
  !existsSync(output) ||
  JSON.stringify(JSON.parse(readFileSync(output, "utf8"))) !== JSON.stringify(entries)
)
  writeFileSync(output, text);
