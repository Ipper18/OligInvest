import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("image tests use the production gateway without starting the seeded import harness", async () => {
  vi.stubEnv("E2E_API_URL", "https://localhost:4443");
  vi.stubEnv("E2E_BASE_URL", "https://localhost:4443");
  const { default: config } = await import("../playwright.config.ts");
  expect(config.projects.some((project) => project.name.endsWith("-real"))).toBe(false);
  expect(config.webServer.some((server) => server.env?.E2E_REAL_API)).toBe(false);
  expect(config.use.baseURL).toBe("https://localhost:4443");
});

test("local seeded API enables the real import projects and proxy", async () => {
  vi.stubEnv("E2E_API_URL", "http://127.0.0.1:4010");
  vi.stubEnv("E2E_BASE_URL", "");
  const { default: config } = await import("../playwright.config.ts");
  expect(config.projects.filter((project) => project.name.endsWith("-real"))).toHaveLength(3);
  expect(config.webServer.find((server) => server.env?.E2E_REAL_API)?.env.API_INTERNAL_URL).toBe(
    "http://127.0.0.1:4010",
  );
});
