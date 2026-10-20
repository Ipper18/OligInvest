import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// The real-import harness needs the seeded local API, never the image gateway.
const realImport = Boolean(process.env.E2E_API_URL && !process.env.E2E_BASE_URL);

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
  projects: (["chromium", "webkit", "firefox"] as const).flatMap((browserName) => [
    {
      name: browserName,
      testIgnore: ["**/shell-auth.spec.ts", "**/portfolio-shell.spec.ts", "**/mvp-real.spec.ts"],
      use: { browserName },
    },
    {
      name: `${browserName}-shell`,
      testMatch: ["**/shell-auth.spec.ts", "**/portfolio-shell.spec.ts"],
      use: { browserName, baseURL: "https://127.0.0.1:3197" },
    },
    ...(realImport
      ? [
          {
            name: `${browserName}-real`,
            testMatch: ["**/mvp-real.spec.ts"],
            use: { browserName, baseURL: "https://127.0.0.1:3196" },
          },
        ]
      : []),
  ]),
  // Synthetic sessions belong only to the local production build and fixture API.
  // Image integration projects keep E2E_BASE_URL and the real API (no auth bypass).
  webServer: [
    ...(realImport
      ? [
          {
            command: "node test/https-server.mjs",
            url: "https://127.0.0.1:3196/logowanie",
            ignoreHTTPSErrors: true,
            reuseExistingServer: false,
            env: {
              NODE_ENV: "production",
              PUBLIC_BASE_URL: "https://127.0.0.1:3196",
              API_INTERNAL_URL: process.env.E2E_API_URL ?? "",
              E2E_REAL_API: process.env.E2E_API_URL ?? "",
              E2E_WEB_PORT: "3196",
            },
          },
        ]
      : []),
    {
      command: "node test/api-fixture.mjs",
      url: "http://127.0.0.1:3198/api/v1/health/live",
      reuseExistingServer: false,
      env: { E2E_API_URL: process.env.E2E_BASE_URL ? "" : (process.env.E2E_API_URL ?? "") },
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
