import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.test.mjs"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    fileParallelism: false,
  },
});
