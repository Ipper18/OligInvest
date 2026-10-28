import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // CI logs distinguish Vite-processed modules from the native import timings.
    experimental: { importDurations: { print: Boolean(process.env.CI), limit: 8 } },
  },
});
