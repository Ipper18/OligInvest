import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build, version as esbuildVersion } from "esbuild";
import {
  isMain,
  readJson,
  report,
  webDirectory,
  withPerformanceServer,
} from "./performance-server.mjs";
import { currentPlan, gzipBytes, measureRoute } from "./route-budgets.mjs";

const RECIPES = {
  "Zod: import * as z":
    'import * as z from "zod"; export const schema = z.strictObject({symbol: z.string(), quantity: z.string()});',
  "Zod: import { z }":
    'import { z } from "zod"; export const schema = z.strictObject({symbol: z.string(), quantity: z.string()});',
  "Zod: zod/mini":
    'import * as z from "zod/mini"; export const schema = z.strictObject({symbol: z.string(), quantity: z.string()});',
  "UI: sześć natywnych prymitywów":
    'export { Button, TextField, SelectField, Disclosure, ModalDialog, Popover } from "@oliginvest/ui";',
};

export async function main() {
  const manifest = readJson(".next/build-manifest.json");
  if (!manifest.rootMainFiles?.length) throw new Error("Missing Next.js framework manifest");
  const sumFiles = (files) =>
    [...new Set(files)].reduce(
      (sum, file) => sum + gzipBytes(readFileSync(resolve(webDirectory, ".next", file))),
      0,
    );
  const rows = [
    ["Next.js: rootMainFiles (wspólny bootstrap)", sumFiles(manifest.rootMainFiles)],
    ["Next.js: polyfille noModule (osobno)", sumFiles(manifest.polyfillFiles)],
  ];
  await withPerformanceServer(async (origin) => {
    for (const { route, budget } of currentPlan().routes) {
      const result = await measureRoute(origin, route, budget);
      rows.push([`Build aplikacji: ${route} (bez noModule)`, result.bytes]);
    }
  });
  for (const [name, contents] of Object.entries(RECIPES)) {
    const result = await build({
      stdin: { contents, resolveDir: webDirectory, sourcefile: "baseline-entry.mjs" },
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["react", "react-dom"],
      write: false,
      logLevel: "error",
    });
    rows.push([name, result.outputFiles.reduce((sum, file) => sum + gzipBytes(file.contents), 0)]);
  }
  const versions = readJson("package.json").dependencies;
  report(
    [
      "### Pomiary bazowe BL-033",
      "",
      `Next.js ${versions.next}, React ${versions.react}, Zod ${versions.zod}; esbuild ${esbuildVersion}; Node ${process.versions.node}.`,
      "Gzip -9; 1 KiB = 1024 B. Biblioteki: ESM, browser/es2022, minifikacja, React zewnętrzny.",
      "",
      "| Wejście | Bajty gzip | KiB |",
      "|---|---:|---:|",
      ...rows.map(([name, bytes]) => `| ${name} | ${bytes} | ${(bytes / 1024).toFixed(2)} |`),
      "",
      "rootMainFiles to bootstrap bieżącego buildu; nie obejmuje całego początkowego JS strony.",
      "Zod: identyczny strictObject z polami symbol i quantity jako string. UI: nazwane eksporty przez publiczne wejście pakietu.",
      "Radix nie jest zainstalowany ani używany w BL-012; nie mierzono hipotetycznego importu.",
    ].join("\n"),
  );
}
if (isMain(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
