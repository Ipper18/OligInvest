import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const FOUNDATIONS = ["identity", "notifications", "market", "portfolio"];
const ENTRIES = ["./contracts", "./jobs", "./server", "./ui"];
const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const IGNORED = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "spike",
  "scripts",
  "migrations",
  "node_modules",
  "dist",
  ".next",
]);
const slash = (path) => path.replaceAll("\\", "/");
const outside = (path) =>
  path === ".." ||
  path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
  isAbsolute(path);

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name) || /\.(test|spec|config)\.[cm]?[jt]sx?$/u.test(entry.name))
      return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

function layerError(from, to) {
  if (to.group === "apps") return "layer: apps cannot be dependencies";
  if (to.group !== "modules") return undefined;
  if (from.group === "packages") return "layer: packages cannot depend on modules";
  if (from.group === "modules") {
    const fromRank = FOUNDATIONS.indexOf(from.id);
    const toRank = FOUNDATIONS.indexOf(to.id);
    if (toRank < 0 || (fromRank >= 0 && toRank >= fromRank))
      return "layer: forbidden module dependency";
  }
  return undefined;
}

function importReferences(source) {
  const references = [];
  function visit(node) {
    let literal;
    let found = false;
    if (node.kind === SyntaxKind.ImportDeclaration || node.kind === SyntaxKind.ExportDeclaration) {
      literal = node.moduleSpecifier;
      found = literal !== undefined;
    } else if (node.kind === SyntaxKind.ImportType) {
      literal = node.argument.literal;
      found = true;
    } else if (node.kind === SyntaxKind.ExternalModuleReference) {
      literal = node.expression;
      found = true;
    } else if (node.kind === SyntaxKind.CallExpression) {
      const expression = node.expression;
      if (
        expression.kind === SyntaxKind.ImportKeyword ||
        (expression.kind === SyntaxKind.Identifier && expression.text === "require") ||
        (expression.kind === SyntaxKind.PropertyAccessExpression &&
          expression.expression.text === "require" &&
          expression.name.text === "resolve")
      ) {
        literal = node.arguments[0];
        found = true;
      }
    }
    if (found) {
      const specifier =
        literal &&
        [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral].includes(literal.kind)
          ? literal.text
          : undefined;
      references.push({ specifier, reexport: node.kind === SyntaxKind.ExportDeclaration });
    }
    node.forEachChild(visit);
  }
  visit(source);
  return references;
}

export function checkDependencies(root) {
  root = resolve(root);
  const packages = [];
  const errors = [];
  const report = (path, message) => errors.push(`${slash(relative(root, path))}: ${message}`);
  for (const group of ["apps", "modules", "packages"]) {
    const directory = join(root, group);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory() || !existsSync(join(path, "package.json"))) continue;
      const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      const dependencies = Object.assign({}, ...SECTIONS.map((section) => manifest[section]));
      packages.push({ group, id: entry.name, path, manifest, dependencies });
    }
  }
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  if (byName.size !== packages.length) errors.push("duplicate workspace package name");
  const edges = new Map(packages.map((pkg) => [pkg, new Set()]));
  for (const pkg of packages) {
    const path = join(pkg.path, "package.json");
    if (
      pkg.group === "modules" &&
      (pkg.manifest.name !== `@oliginvest/mod-${pkg.id}` ||
        JSON.stringify(Object.keys(pkg.manifest.exports ?? {}).sort()) !== JSON.stringify(ENTRIES))
    ) {
      report(path, "module exports: expected only contracts/server/jobs/ui and canonical name");
    }
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      const target = byName.get(name);
      if (target) {
        edges.get(pkg).add(target);
        const error = layerError(pkg, target);
        if (error) report(path, `${name}: ${error}`);
      } else if (name.startsWith("@oliginvest/") || version.startsWith("workspace:")) {
        report(path, `${name}: unknown workspace dependency`);
      }
      if (pkg.group === "apps" && pkg.id === "web" && name === "@oliginvest/db")
        report(path, "web: DB dependency forbidden");
      if (
        pkg.group === "packages" &&
        pkg.id === "core" &&
        name !== "decimal.js" &&
        ["dependencies", "peerDependencies", "optionalDependencies"].some((section) =>
          Object.hasOwn(pkg.manifest[section] ?? {}, name),
        )
      ) {
        report(path, `core: forbidden runtime dependency ${name}`);
      }
    }
  }

  const files = packages.flatMap((pkg) =>
    [
      ...["src", "db", "app", "pages"].flatMap((directory) =>
        sourceFiles(join(pkg.path, directory)),
      ),
      ...["proxy.ts", "middleware.ts"].map((file) => join(pkg.path, file)).filter(existsSync),
    ].map((path) => ({ pkg, path })),
  );
  if (files.length) {
    const api = new API();
    try {
      const snapshot = api.updateSnapshot({ openFiles: files.map(({ path }) => path) });
      try {
        for (const { pkg, path } of files) {
          const project = snapshot.getDefaultProjectForFile(path);
          const source = project?.program.getSourceFile(path);
          if (!source) {
            report(path, "cannot parse source");
            continue;
          }
          if (project.program.getSyntacticDiagnostics(path).length)
            report(path, "invalid source syntax");
          for (const { specifier, reexport } of importReferences(source)) {
            if (specifier === undefined) {
              report(path, "import requires a literal specifier");
              continue;
            }
            if (specifier.startsWith(".")) {
              if (outside(relative(pkg.path, resolve(dirname(path), specifier))))
                report(path, `${specifier}: relative boundary crossed`);
              continue;
            }
            if (isAbsolute(specifier) || specifier.startsWith("file:")) {
              report(path, "absolute import forbidden");
              continue;
            }
            if (pkg.group === "packages" && pkg.id === "core" && specifier !== "decimal.js")
              report(path, `core: forbidden import ${specifier}`);
            const parts = specifier.split("/");
            const name = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
            const entry = `.${specifier.slice(name.length)}`;
            const target = byName.get(name);
            if (
              name !== pkg.manifest.name &&
              !Object.hasOwn(pkg.dependencies, name) &&
              !BUILTINS.has(specifier)
            )
              report(path, `${specifier}: undeclared dependency`);
            if (!target) continue;
            if (target !== pkg) {
              edges.get(pkg).add(target);
              const error = layerError(pkg, target);
              if (error) report(path, `${specifier}: ${error}`);
            }
            if (!Object.hasOwn(target.manifest.exports ?? {}, entry))
              report(path, `${specifier}: not a public export`);
            if (target.group === "modules") {
              if (
                pkg.group === "modules" &&
                target !== pkg &&
                !FOUNDATIONS.includes(pkg.id) &&
                !["./contracts", "./server"].includes(entry)
              )
                report(path, `${specifier}: forbidden feature entry`);
              const local = slash(relative(pkg.path, path));
              const route =
                pkg.id === "web" && reexport && /^(src\/)?app\//u.test(local) && entry === "./ui";
              if (pkg.group === "apps" && local !== "src/modules.ts" && !route)
                report(path, `${specifier}: module import outside composition registry`);
            }
            if (
              pkg.group === "apps" &&
              pkg.id === "web" &&
              (target.id === "db" ||
                (target.group === "modules" && ["./server", "./jobs"].includes(entry)))
            )
              report(path, `${specifier}: web server import forbidden`);
          }
        }
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  }
  const visited = new Set();
  const active = new Set();
  function visit(pkg) {
    if (active.has(pkg)) {
      report(join(pkg.path, "package.json"), "workspace dependency cycle");
      return;
    }
    if (visited.has(pkg)) return;
    visited.add(pkg);
    active.add(pkg);
    for (const dependency of edges.get(pkg)) visit(dependency);
    active.delete(pkg);
  }
  for (const pkg of packages) visit(pkg);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = checkDependencies(process.cwd());
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else console.log("Granice zależności: OK.");
  } catch (error) {
    console.error(`Kontrola zależności nie powiodła się: ${error.message}`);
    process.exitCode = 1;
  }
}
