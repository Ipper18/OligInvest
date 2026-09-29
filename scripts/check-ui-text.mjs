import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind as K } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const POLICY_PATH = "packages/i18n/src/compliance/forbidden-phrases.pl.json";
const IGNORED = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  "test",
  "tests",
  "e2e",
  "fixtures",
  "scripts",
  ".venv",
]);
const TEXT_ATTRIBUTES = new Set([
  "title",
  "alt",
  "placeholder",
  "aria-label",
  "aria-description",
  "label",
  "description",
  "summary",
  "children",
  "text",
]);
const slash = (path) => path.replaceAll("\\", "/");
const normalize = (text) =>
  text.normalize("NFKC").toLocaleLowerCase("pl-PL").replace(/\s+/gu, " ").trim();
const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const meaningful = (text) => /[\p{L}\p{N}]/u.test(text);

export function forbiddenMatches(text, policy) {
  const normalized = normalize(text);
  return policy.phrases.filter((phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${escapePattern(normalize(phrase))}(?![\\p{L}\\p{N}_])`, "u").test(
      normalized,
    ),
  );
}

function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name) || /\.(?:test|spec)\./u.test(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function strings(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, child]) =>
      strings(child, path ? `${path}.${key}` : key),
    );
  return [];
}

export function checkUiText(root = ROOT, { literals = true, compliance = true } = {}) {
  const policy = JSON.parse(readFileSync(join(ROOT, POLICY_PATH), "utf8"));
  const errors = [];
  const report = (path, rule, text) =>
    errors.push(`${slash(relative(root, path))}: ${rule}: ${text}`);
  const scan = (path, text) => {
    for (const phrase of forbiddenMatches(text, policy)) report(path, "forbidden-phrase", phrase);
  };
  const paths = ["apps", "modules", "packages"].flatMap((group) => files(join(root, group)));
  if (compliance) {
    for (const path of paths) {
      const local = slash(relative(root, path));
      if (
        local.startsWith("packages/i18n/src/") &&
        path.endsWith(".json") &&
        local !== POLICY_PATH
      ) {
        const dictionary = JSON.parse(readFileSync(path, "utf8"));
        for (const [key, text] of strings(dictionary)) {
          const exception = policy.exceptions.find(
            (item) => item.file === local && item.keys.includes(key),
          );
          if (!exception) scan(path, text);
        }
      }
      if (path.endsWith(".mdx")) scan(path, readFileSync(path, "utf8").replace(/<[^>]*>/gu, " "));
    }
  }
  const components = paths.filter((path) => /\.[jt]sx$/u.test(path));
  if (!components.length) return errors;
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openFiles: components });
    try {
      for (const path of components) {
        const project = snapshot.getDefaultProjectForFile(path);
        const source = project?.program.getSourceFile(path);
        if (!source || project.program.getSyntacticDiagnostics(path).length) {
          report(path, "parse", "Cannot parse component");
          continue;
        }
        const componentText = [];
        function literal(node) {
          if (!node) return;
          if (
            [
              K.StringLiteral,
              K.NoSubstitutionTemplateLiteral,
              K.TemplateHead,
              K.TemplateMiddle,
              K.TemplateTail,
            ].includes(node.kind)
          ) {
            if (meaningful(node.text)) report(path, "jsx-literal", node.text);
            return;
          }
          if (node.kind === K.ConditionalExpression) {
            literal(node.whenTrue);
            literal(node.whenFalse);
            return;
          }
          if (
            node.kind === K.BinaryExpression &&
            [K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken].includes(
              node.operatorToken.kind,
            )
          ) {
            literal(node.right);
            return;
          }
          // Property names/index keys and handler logic are not rendered text.
          if (
            [
              K.ElementAccessExpression,
              K.PropertyAccessExpression,
              K.ArrowFunction,
              K.FunctionExpression,
            ].includes(node.kind)
          )
            return;
          node.forEachChild(literal);
        }
        function visit(node) {
          if (
            compliance &&
            [
              K.JsxText,
              K.StringLiteral,
              K.NoSubstitutionTemplateLiteral,
              K.TemplateHead,
              K.TemplateMiddle,
              K.TemplateTail,
            ].includes(node.kind)
          ) {
            componentText.push(node.text);
            scan(path, node.text);
          }
          if (literals && node.kind === K.JsxText && meaningful(node.text))
            report(path, "jsx-literal", node.text.trim());
          if (literals && node.kind === K.JsxAttribute && TEXT_ATTRIBUTES.has(node.name.text))
            literal(node.initializer);
          if (literals && [K.JsxElement, K.JsxFragment].includes(node.kind)) {
            for (const child of node.children)
              if (child.kind === K.JsxExpression) literal(child.expression);
          }
          node.forEachChild(visit);
        }
        visit(source);
        if (compliance) scan(path, componentText.join(" "));
      }
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
  return [...new Set(errors)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkUiText();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Teksty UI: OK.");
}
