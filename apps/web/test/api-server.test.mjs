import { afterEach, expect, test, vi } from "vitest";

const context = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => context.headers }));
const { getApiClient, getHealthStatus } = await import("../src/api/server.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PUBLIC_BASE_URL", "https://example.test");
  vi.stubEnv("API_INTERNAL_URL", "http://api.example.test");
  context.headers = new Headers({
    cookie: "session=synthetic",
    "x-request-id": crypto.randomUUID(),
    "accept-language": "pl-PL",
    authorization: "discard",
  });
  const fetch = vi.fn(async () => Response.json({ status: "ok" }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test("forwards request context only to configured API, disabling cache and redirects", async () => {
  const fetch = setup();
  const client = await getApiClient();
  await client.GET("/health/live", {
    cache: "force-cache",
    redirect: "follow",
    headers: { cookie: "override" },
  });
  const request = fetch.mock.calls[0][0];
  expect(request.url).toBe("http://api.example.test/api/v1/health/live");
  expect(request.headers.get("cookie")).toBe("session=synthetic");
  expect(request.headers.get("x-request-id")).toBe(context.headers.get("x-request-id"));
  expect(request.headers.get("accept-language")).toBe("pl-PL");
  expect(request.headers.has("authorization")).toBe(false);
  expect(request.cache).toBe("no-store");
  expect(request.redirect).toBe("error");
});

test("separate request contexts never reuse a session", async () => {
  const fetch = setup();
  const first = await getApiClient();
  context.headers = new Headers({ cookie: "session=second", "x-request-id": crypto.randomUUID() });
  const second = await getApiClient();
  await Promise.all([first.GET("/health/live"), second.GET("/health/live")]);
  expect(fetch.mock.calls.map(([request]) => request.headers.get("cookie"))).toEqual([
    "session=synthetic",
    "session=second",
  ]);
});

test("rejects caller overrides that would send credentials outside the API boundary", async () => {
  const fetch = setup();
  const client = await getApiClient();
  for (const path of ["https://evil.test/", "/../auth/session", "/%2e%2e/auth/session"])
    await expect(client.GET(path)).rejects.toThrow("API boundary");
  await expect(client.GET("/health/live", { baseUrl: "https://evil.test/api/v1" })).rejects.toThrow(
    "API boundary",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("validates health response with a closed schema and handles an unavailable API", async () => {
  const fetch = setup();
  expect(await getHealthStatus()).toBe("ok");
  fetch.mockResolvedValueOnce(Response.json({ status: "ok", unexpected: true }));
  expect(await getHealthStatus()).toBe("unavailable");
  fetch.mockRejectedValueOnce(new Error("connection failed"));
  expect(await getHealthStatus()).toBe("unavailable");
});
