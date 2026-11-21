import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// BL-112/501/509: the admin Server Action forwards only allow-listed operations to the internal
// API. The browser never supplies a host, protocol, query or path segment other than a strict UUID.
const h = vi.hoisted(() => ({ admin: 0 }));
vi.mock("../src/admin/data", () => ({
  requireAdmin: async () => {
    h.admin += 1;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=fixture", "x-request-id": "req-1" }),
}));
vi.mock("@oliginvest/config", () => ({
  loadConfig: () => ({
    API_INTERNAL_URL: "http://api.internal.test:3001/ignored/path?x=1",
    PUBLIC_BASE_URL: "https://app.example.test",
  }),
}));

const { adminMutation } = await import("../src/admin/actions.ts");
const ID = "01900000-0000-7000-8000-000000000201";
const KEY = "01900000-0000-7000-8000-000000000301";
const fetchMock = vi.fn();

beforeEach(() => {
  h.admin = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const cases = [
  [{ op: "updateUser", id: ID, body: { role: "pro" } }, "PATCH", `/api/v1/admin/users/${ID}`],
  [{ op: "deleteUser", id: ID }, "DELETE", `/api/v1/admin/users/${ID}`],
  [{ op: "cancelDeletion", id: ID }, "DELETE", `/api/v1/admin/users/${ID}/deletion-request`],
  [
    { op: "resetTwoFactor", id: ID, body: { reason: "lost device" } },
    "POST",
    `/api/v1/admin/users/${ID}/reset-2fa`,
  ],
  [{ op: "revokeUserSessions", id: ID }, "POST", `/api/v1/admin/users/${ID}/revoke-sessions`],
  [{ op: "revokeSession", id: ID }, "DELETE", `/api/v1/admin/sessions/${ID}`],
  [{ op: "revokeInvitation", id: ID }, "DELETE", `/api/v1/admin/invitations/${ID}`],
  [
    {
      op: "createInvitation",
      key: KEY,
      body: { email: "new@example.test", role: "user", expiresInHours: 24, sendEmail: false },
    },
    "POST",
    "/api/v1/admin/invitations",
  ],
];

test.each(cases)(
  "operation %j goes to exactly one internal URL and method",
  async (input, method, path) => {
    expect((await adminMutation(input)).status).toBe(204);
    expect(h.admin).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    // Host and protocol always come from API_INTERNAL_URL; its path and query are dropped.
    expect(url.href).toBe(`http://api.internal.test:3001${path}`);
    expect(init.method).toBe(method);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.headers.get("origin")).toBe("https://app.example.test");
    if ("body" in input) expect(JSON.parse(init.body)).toEqual(input.body);
    else expect(init.body).toBeUndefined();
    if (input.op === "createInvitation") expect(init.headers.get("Idempotency-Key")).toBe(KEY);
  },
);

const hostile = [
  "",
  "not-a-uuid",
  `${ID}/../../users`,
  `../${ID}`,
  `${ID}/x`,
  `${ID}%2f..`,
  `${ID}?x=1`,
  `${ID}#x`,
  `user@${ID}`,
  `http://evil.example.test/${ID}`,
  `//evil.example.test/${ID}`,
  `${ID}\\x`,
  ` ${ID}`,
  `${ID} `,
  `${ID}\n`,
  `{${ID}}`,
  ID.toUpperCase().replace("7000", "7G00"),
  ID.replaceAll("-", ""),
];

test.each(hostile)("id %j is rejected with 422 and no request", async (value) => {
  for (const op of [
    "deleteUser",
    "cancelDeletion",
    "revokeUserSessions",
    "revokeSession",
    "revokeInvitation",
  ]) {
    expect(await adminMutation({ op, id: value })).toEqual({
      status: 422,
      code: "VALIDATION_FAILED",
    });
  }
  expect(
    await adminMutation({
      op: "createInvitation",
      key: value,
      body: { email: "new@example.test", role: "user", expiresInHours: 24, sendEmail: false },
    }),
  ).toEqual({ status: 422, code: "VALIDATION_FAILED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("unknown operations, extra fields and non-objects are rejected without a request", async () => {
  for (const input of [
    { op: "deleteEverything", id: ID },
    { op: "deleteUser", id: ID, path: "/admin/users" },
    { op: "deleteUser", id: ID, url: "http://evil.example.test" },
    { op: "deleteUser", id: ID, method: "GET" },
    { op: "revokeSession", id: ID, host: "evil.example.test" },
    { op: "createInvitation", body: {} },
    null,
    "deleteUser",
    [ID],
  ])
    expect(await adminMutation(input)).toEqual({ status: 422, code: "VALIDATION_FAILED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("problem bodies return only the code; network errors become 503", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ code: "STEP_UP_REQUIRED", detail: "x" }, { status: 403 }),
  );
  expect(await adminMutation({ op: "deleteUser", id: ID })).toEqual({
    status: 403,
    code: "STEP_UP_REQUIRED",
  });
  fetchMock.mockRejectedValueOnce(new Error("OFFLINE"));
  expect(await adminMutation({ op: "deleteUser", id: ID })).toEqual({
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  });
});

test("the admin action builds URLs only from the internal origin and fixed segments", () => {
  const source = readFileSync(new URL("../src/admin/actions.ts", import.meta.url), "utf8");
  const fetches = source.match(/fetch\(/g) ?? [];
  expect(fetches).toHaveLength(1);
  // The only URL constructor takes the configured internal origin as its base.
  expect(source.match(/new URL\(/g)).toHaveLength(3);
  expect(source).toContain("new URL(config.API_INTERNAL_URL).origin");
  expect(source).toContain('redirect: "error"');
  expect(source).not.toMatch(/raw\.(url|host|path|href)|input\.(url|host|path)/);
});
