import { expect, test, vi } from "vitest";
import { createApp } from "../dist/app.js";

test("metrics expose route templates without paths, cookies or request identifiers", async () => {
  const recordError = vi.fn(async () => {});
  const app = createApp({
    publicBaseUrl: "https://example.test",
    logger: { info() {}, warn() {}, error() {} },
    recordError,
    checks: Object.fromEntries(
      ["postgres", "valkeyQueue", "valkeyCache"].map((name) => [
        name,
        async () => {
          throw new Error("private-message");
        },
      ]),
    ),
  });
  await app.request("/private-user-path?token=secret", { headers: { Cookie: "secret-cookie" } });
  await app.request("/api/v1/health/ready");
  const response = await app.request("/internal/metrics");
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("http_requests_total");
  expect(body).toContain('status="503"');
  expect(body).not.toMatch(/private-user-path|secret|private-message/);
  expect(recordError).toHaveBeenCalledOnce();
  expect(recordError.mock.calls[0][0]).toMatchObject({ source: "api", code: "HTTP_SERVER_ERROR" });
});
