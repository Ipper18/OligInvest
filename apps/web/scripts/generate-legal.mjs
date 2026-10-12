import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createProcessor } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";

const root = new URL("../../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8").replaceAll("\r\n", "\n");
export function generateLegal() {
  const catalog = {},
    files = {};
  for (const [id, name] of Object.entries({
    terms: "regulamin",
    privacy: "informacja-o-prywatnosci",
    sources: "zrodla-danych",
  })) {
    const source =
      read(`docs/12-dla-uzytkownika/${name}.md`).split("\n---\n").slice(1).join("\n---\n").trim() +
      "\n";
    const tree = createProcessor({ format: "md", remarkPlugins: [remarkGfm] }).parse(source);
    const copy = { source },
      edits = [];
    function visit(node) {
      if (node.type === "text" || node.type === "inlineCode") {
        const key = `t${Object.keys(copy).length - 1}`;
        copy[key] = node.value;
        const expression = `{legalText(legalCopy.${id}.${key})}`;
        edits.push({
          start: node.position.start.offset,
          end: node.position.end.offset,
          value: node.type === "inlineCode" ? `<code>${expression}</code>` : expression,
        });
      } else if (node.type === "html" || node.type === "code")
        throw new Error("Unexpected executable legal content");
      else node.children?.forEach(visit);
    }
    visit(tree);
    let mdx = source;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      mdx = mdx.slice(0, edit.start) + edit.value + mdx.slice(edit.end);
    files[`apps/web/src/legal/${id}.mdx`] =
      `import { legalCopy } from '@oliginvest/i18n/legal'\nimport { legalText } from './configuration'\n\n${mdx}`;
    catalog[id] = copy;
  }
  catalog.labels = {
    missing: "Dane instancji wymagają uzupełnienia przez administratora.",
    print: "Drukuj",
  };
  files["packages/i18n/src/pl/legal.json"] = JSON.stringify(catalog, null, 2) + "\n";
  return files;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  for (const [p, value] of Object.entries(generateLegal())) writeFileSync(new URL(p, root), value);
