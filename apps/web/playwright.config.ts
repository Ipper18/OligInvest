import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "dot",
  use: { baseURL: "http://127.0.0.1:3197", browserName: "chromium" },
  webServer: [
    {
      command: "node test/api-fixture.mjs",
      url: "http://127.0.0.1:3198/api/v1/health/live",
      reuseExistingServer: false,
    },
    {
      command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3197",
      url: "http://127.0.0.1:3197",
      reuseExistingServer: false,
      env: {
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "https://example.test",
        API_INTERNAL_URL: "http://127.0.0.1:3198",
      },
    },
  ],
});
