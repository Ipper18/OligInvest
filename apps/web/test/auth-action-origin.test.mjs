// BL-602: ZAP 10202 ("Absence of Anti-CSRF Tokens") flags the sign-in and reset forms, which post
// through /auth/action. CSRF protection there is the same-origin guard (SEC § 3.6), pinned here.
import { beforeEach, expect, it, vi } from "vitest";

const relayAction = vi.fn(async () => ({ ok: true }));
vi.mock("../src/auth/relay", () => ({ relayAction }));
const { POST } = await import("../src/app/auth/action/route.ts");

const body = JSON.stringify({ name: "signIn", input: {} });
const call = (headers, payload = body) =>
  POST(
    new Request("https://invest.example.test/auth/action", {
      method: "POST",
      headers,
      body: payload,
    }),
  );
const json = { "content-type": "application/json", host: "invest.example.test" };

beforeEach(() => relayAction.mockClear());

it("refuses cross-site, origin-less and mismatched requests before reading the body", async () => {
  for (const headers of [
    { ...json },
    { ...json, origin: "https://evil.example" },
    { ...json, origin: "null" },
    { ...json, origin: "https://invest.example.test", "sec-fetch-site": "cross-site" },
    { ...json, origin: "https://invest.example.test", "sec-fetch-site": "same-site" },
    { ...json, origin: "https://invest.example.test.evil.example" },
  ]) {
    const response = await call(headers);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(relayAction).not.toHaveBeenCalled();
});

it("refuses a same-origin simple form post (no JSON), so an HTML form cannot forge it", async () => {
  const headers = {
    host: "invest.example.test",
    origin: "https://invest.example.test",
    "content-type": "application/x-www-form-urlencoded",
  };
  expect((await call(headers, "name=signIn")).status).toBe(415);
  expect(relayAction).not.toHaveBeenCalled();
});

it("relays a same-origin JSON request, also behind the edge (x-forwarded-host)", async () => {
  const direct = {
    ...json,
    origin: "https://invest.example.test",
    "sec-fetch-site": "same-origin",
  };
  expect((await call(direct)).status).toBe(200);
  const proxied = {
    "content-type": "application/json",
    host: "127.0.0.1:3000",
    "x-forwarded-host": "invest.example.test",
    origin: "https://invest.example.test",
  };
  expect((await call(proxied)).status).toBe(200);
  expect(relayAction).toHaveBeenCalledTimes(2);
});
