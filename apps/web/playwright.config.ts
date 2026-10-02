import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["dot"],
    [
      "html",
      {
        open: "never",
        outputFolder: fileURLToPath(new URL("./playwright-report", import.meta.url)),
      },
    ],
  ],
  use: { ignoreHTTPSErrors: true, baseURL: process.env.E2E_BASE_URL || "https://127.0.0.1:3197" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node test/api-fixture.mjs",
          url: "http://127.0.0.1:3198/api/v1/health/live",
          reuseExistingServer: false,
        },
        {
          command: "node test/https-server.mjs",
          url: "https://127.0.0.1:3197",
          ignoreHTTPSErrors: true,
          reuseExistingServer: false,
          env: {
            NODE_ENV: "production",
            PUBLIC_BASE_URL: "https://example.test",
            API_INTERNAL_URL: "http://127.0.0.1:3198",
          },
        },
      ],
});
