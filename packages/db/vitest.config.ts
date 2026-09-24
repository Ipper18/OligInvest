import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Schema inventory is a tooling test: resolve public entries from source on a clean checkout.
  resolve: {
    alias: {
      "@oliginvest/mod-identity/server": fileURLToPath(
        new URL("../../modules/identity/src/server/index.ts", import.meta.url),
      ),
      "@oliginvest/mod-market/server": fileURLToPath(
        new URL("../../modules/market/src/server/index.ts", import.meta.url),
      ),
    },
  },
  test: { exclude: [...configDefaults.exclude, "integration/**"] },
});
