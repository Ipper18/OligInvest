import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("local dev origins are absent in production; auth action arguments are never logged", async () => {
  for (const mode of ["development", "production", "test"]) {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("API_INTERNAL_URL", "http://localhost:3001");
    vi.resetModules();
    const { default: config } = await import("../next.config");
    expect(config.logging.serverFunctions).toBe(false);
    if (mode === "development") {
      expect(await config.rewrites()).toEqual([
        { source: "/api/:path*", destination: "http://localhost:3001/api/:path*" },
      ]);
      vi.stubEnv("API_INTERNAL_URL", "http://[::1]:3001");
      expect((await config.rewrites())[0].destination).toBe("http://localhost:3001/api/:path*");
    } else expect(config.rewrites).toBeUndefined();
    expect(config.allowedDevOrigins).toEqual(
      mode === "development" ? ["localhost", "127.0.0.1", "[::1]"] : undefined,
    );
  }
});
