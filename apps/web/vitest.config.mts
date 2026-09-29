import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.mjs"] },
  oxc: { jsx: { runtime: "automatic" } },
});
