import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests import the public entry by name; resolve it from source so coverage maps to src/*.ts.
  resolve: {
    alias: {
      "@oliginvest/core": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // AGENTS.md § 5.2: packages/core line coverage ≥ 90 %.
      thresholds: { lines: 90 },
    },
  },
});
