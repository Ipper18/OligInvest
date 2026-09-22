import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESERVED =
  /^(identity|notifications|market|portfolio|admin|con|prn|aux|nul|com[0-9]|lpt[0-9])$/u;

export function generateModule(root, name) {
  if (
    typeof name !== "string" ||
    name.length > 64 ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name) ||
    RESERVED.test(name)
  ) {
    throw new Error("Nieprawidłowa lub zarezerwowana nazwa modułu; użyj kebab-case (1–64 znaki).");
  }
  const modules = resolve(root, "modules");
  if (!existsSync(modules)) throw new Error("Uruchom generator w katalogu głównym workspace.");
  if (readdirSync(modules).some((entry) => entry.toLowerCase() === name))
    throw new Error("Moduł już istnieje; generator nie nadpisuje plików.");
  const path = join(modules, name);
  const exports = Object.fromEntries(
    Object.entries({
      contracts: "src/contracts",
      server: "src/server/index",
      jobs: "src/jobs",
      ui: "src/ui/index",
    }).map(([entry, target]) => [
      `./${entry}`,
      {
        types: `./dist/${target}.d.ts`,
        import: `./dist/${target}.js`,
        default: `./dist/${target}.js`,
      },
    ]),
  );
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  const files = {
    "package.json": json({
      name: `@oliginvest/mod-${name}`,
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        lint: "biome check .",
        typecheck: "tsc -p tsconfig.json --noEmit",
        test: "vitest run",
        build: "tsc -p tsconfig.json",
      },
      exports,
      dependencies: { "@oliginvest/platform": "workspace:*" },
    }),
    "tsconfig.json": json({
      extends: "../../tsconfig.base.json",
      compilerOptions: { rootDir: ".", outDir: "dist", types: [] },
      include: ["src/**/*.ts", "db/**/*.ts"],
    }),
    "src/contracts.ts": `import type { ModuleMetadata } from "@oliginvest/platform/modules";

export const MODULE_ID = "${name}";
export const MODULE_FLAG = "module.${name}";

export const moduleMetadata: ModuleMetadata = {
  id: MODULE_ID,
  layer: "feature",
  version: "0.0.0",
  featureFlag: MODULE_FLAG,
  permissions: [],
};

// Dodaj schematy Zod .strict() dla rzeczywistych DTO, zdarzeń i zadań.
`,
    "src/domain/index.ts": "export {};\n",
    "src/module.ts": `import type { ModuleDefinition } from "@oliginvest/platform/modules";
import { moduleMetadata } from "./contracts.js";

export const moduleDefinition: ModuleDefinition<unknown> = {
  ...moduleMetadata,
  routes() {},
};
`,
    "src/server/index.ts": `export * from "../../db/schema.js";
export { moduleDefinition } from "../module.js";
`,
    "src/jobs.ts": `import type { JobsModuleDefinition } from "@oliginvest/platform/modules";
import { MODULE_ID } from "./contracts.js";

export const jobsDefinition: JobsModuleDefinition = {
  id: MODULE_ID,
  queues: [],
  handlers: {},
};
`,
    "src/ui-module.ts": `import type { UiModuleDefinition } from "@oliginvest/platform/modules";
import { MODULE_ID } from "./contracts.js";

export const uiDefinition: UiModuleDefinition = {
  id: MODULE_ID,
  nav: [],
};
`,
    "src/ui/index.ts": 'export { uiDefinition } from "../ui-module.js";\n',
    "db/schema.ts":
      "// Dodaj tabele razem z migracją, politykami RLS i testami izolacji.\nexport {};\n",
    "db/rls.sql":
      "-- Brak tabel w szkielecie. Tabele z user_id wymagają FORCE ROW LEVEL SECURITY i testów.\n",
    "test/fixtures/anonymized/.gitkeep": "",
    "test/module.test.mjs": `import { createRequire } from "node:module";
import { moduleMetadata } from "@oliginvest/mod-${name}/contracts";
import { jobsDefinition } from "@oliginvest/mod-${name}/jobs";
import { moduleDefinition } from "@oliginvest/mod-${name}/server";
import { uiDefinition } from "@oliginvest/mod-${name}/ui";
import {
  ApiModuleRegistry,
  JobsModuleRegistry,
  ModuleCatalog,
  UiModuleRegistry,
} from "@oliginvest/platform/modules";
import { expect, test } from "vitest";

test("registers all definitions and disables the feature by default", async () => {
  const catalog = new ModuleCatalog([moduleMetadata]);
  const api = new ApiModuleRegistry(catalog);
  const jobs = new JobsModuleRegistry(catalog);
  const ui = new UiModuleRegistry(catalog);
  api.register(moduleDefinition);
  jobs.register(jobsDefinition);
  ui.register(uiDefinition);
  await expect(catalog.isEnabled(moduleMetadata.id, {})).resolves.toBe(false);
  await expect(api.require(moduleMetadata.id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(ui.navigation({})).resolves.toEqual([]);
  await expect(jobs.schedules({})).resolves.toEqual([]);
});

test("allows the API definition when its flag is enabled", async () => {
  const catalog = new ModuleCatalog([moduleMetadata], () => true);
  const api = new ApiModuleRegistry(catalog);
  api.register(moduleDefinition);
  await expect(api.require(moduleMetadata.id, {})).resolves.toMatchObject({ id: moduleMetadata.id });
});

test("keeps module internals private", () => {
  const require = createRequire(import.meta.url);
  expect(() => require.resolve("@oliginvest/mod-${name}/module")).toThrowError(
    expect.objectContaining({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }),
  );
});
`,
    "README.md": `# Moduł ${name}

**Cel:** szkielet modułu funkcjonalnego; zakres domenowy należy opisać przed implementacją.

Flaga \`module.${name}\` jest domyślnie wyłączona. Szkielet nie montuje tras,
nie deklaruje tabel, kolejek, uprawnień ani nawigacji.

Po wygenerowaniu zaktualizuj lokalne powiązania workspace:

\`\`\`sh
pnpm install --lockfile-only --offline
pnpm install --frozen-lockfile
pnpm check:deps
pnpm turbo run lint typecheck test build --filter=@oliginvest/mod-${name}
\`\`\`

Przed udostępnieniem zrealizuj [moduly.md § 8.1](../../docs/01-architektura/moduly.md#81-dodanie-nowego-modułu):

- Wymagania FR/NFR, katalog modułów, macierz pokrycia i backlog; ADR, jeśli wymagany.
- Kontrakty Zod strict; OpenAPI przed routerem Hono; JSON Schema dla zadań Pythona.
- Tabele, migracje, RLS i testy izolacji, jeśli moduł przechowuje dane.
- Handlery przez createBoundaryHandler, idempotencja i publikacja zdarzeń po COMMIT.
- Cienkie re-eksporty UI, klucze i18n i leniwe ładowanie ciężkich komponentów.
- Rejestracja przez publiczne eksporty w apps/api/src/modules.ts, apps/jobs/src/modules.ts
  i apps/web/src/modules.ts; uprawnienia i flaga w katalogu platformy.
- Budżet trasy, STRIDE, edukacja i komponenty zgodności tam, gdzie dotyczą funkcji.
- Testy domenowe, RLS i e2e odpowiednie do funkcji oraz build bez modułu.
`,
  };
  mkdirSync(path); // Atomic reservation: never write into an existing directory.
  for (const [file, content] of Object.entries(files)) {
    const target = join(path, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { flag: "wx" });
  }
  execFileSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome")),
      "check",
      "--write",
      "--vcs-enabled=false",
      "--files-ignore-unknown=true",
      `--config-path=${fileURLToPath(new URL("../biome.json", import.meta.url))}`,
      path,
    ],
    { stdio: "pipe" },
  );
  return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Użycie: pnpm gen:module <nazwa>");
    generateModule(process.cwd(), process.argv[2]);
    console.log("Moduł utworzony. Dalsze kroki i polecenia sprawdzające: README.md nowego modułu.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
