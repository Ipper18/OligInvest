import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createLogger,
  currentRequest,
  PROBLEM_DEFINITIONS,
  ProblemError,
  parseBoundary,
  problemResponse,
  requestLogger,
  withIdentity,
  withRequestContext,
} from "@oliginvest/platform";
import { expect, test } from "vitest";
import { z } from "zod";

function capture() {
  const lines = [];
  return { lines, logger: createLogger({ write: (line) => lines.push(JSON.parse(line)) }) };
}
const base = "https://example.test";
const request = (id) =>
  new Request(`${base}/test?token=do-not-log`, { headers: id ? { "X-Request-Id": id } : {} });

test("concurrent requests isolate identities and correlate header, context and safe log", async () => {
  const { logger, lines } = capture();
  const ids = [randomUUID(), randomUUID()];
  const users = [randomUUID(), randomUUID()];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const pending = ids.map((id, index) =>
    withRequestContext(request(id), { logger, publicBaseUrl: base, route: "/test" }, async () => {
      return withIdentity({ userId: users[index], role: "user" }, async () => {
        await barrier;
        expect(currentRequest().requestId).toBe(id);
        expect(currentRequest().userId).toBe(users[index]);
        requestLogger().info({
          event: "operation.completed",
          request_id: randomUUID(),
          user_id: randomUUID(),
        });
        return new Response("ok");
      });
    }),
  );
  release();
  const responses = await Promise.all(pending);
  expect(responses.map((response) => response.headers.get("X-Request-Id"))).toEqual(ids);
  expect(
    lines
      .filter((line) => line.event === "request.completed")
      .map((line) => line.request_id)
      .sort(),
  ).toEqual([...ids].sort());
  for (const line of lines) expect(line.user_id).toBe(users[ids.indexOf(line.request_id)]);
  expect(JSON.stringify(lines)).not.toContain("do-not-log");
  expect(() => currentRequest()).toThrow(/No request context/);
});
test("identity boundaries reject unknown fields and switching actors within a request", async () => {
  const { logger } = capture();
  await withRequestContext(request(), { logger, publicBaseUrl: base, route: "/test" }, async () => {
    expect(() =>
      withIdentity({ userId: randomUUID(), role: "user", admin: true }, () => {}),
    ).toThrow(ProblemError);
    withIdentity({ userId: randomUUID(), role: "user" }, () => {
      expect(() => withIdentity({ userId: randomUUID(), role: "admin" }, () => {})).toThrow(
        ProblemError,
      );
    });
    expect(currentRequest().userId).toBeUndefined();
    return new Response(null, { status: 204 });
  });
});
test.each([undefined, "not-a-uuid", "a".repeat(1000)])(
  "missing or invalid request ID is replaced: %s",
  async (id) => {
    const { logger } = capture();
    const response = await withRequestContext(
      request(id),
      { logger, publicBaseUrl: base, route: "/test" },
      async () => {
        throw new Error("private-secret-and-stack");
      },
    );
    const problem = await response.json();
    expect(z.uuid().safeParse(problem.instance).success).toBe(true);
    expect(response.headers.get("X-Request-Id")).toBe(problem.instance);
    expect(problem.code).toBe("INTERNAL");
    expect(JSON.stringify(problem)).not.toContain("private");
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  },
);
test("valid client ID survives error; response cannot override it; spoofed identity is ignored", async () => {
  const { logger } = capture();
  const id = randomUUID();
  const req = request(id);
  req.headers.set("X-User-Id", randomUUID());
  const response = await withRequestContext(
    req,
    { logger, publicBaseUrl: base, route: "/test" },
    async () => {
      expect(currentRequest().userId).toBeUndefined();
      return new Response("ok", { headers: { "X-Request-Id": "spoofed" } });
    },
  );
  expect(response.headers.get("X-Request-Id")).toBe(id);
  const failed = await withRequestContext(
    request(id),
    { logger, publicBaseUrl: base, route: "/test" },
    async () => {
      throw new ProblemError("FORBIDDEN");
    },
  );
  expect((await failed.json()).instance).toBe(id);
});
test("strict boundary rejects unknown and nested fields without reflecting secret record keys", () => {
  const shape = {
    count: z.number().int().positive(),
    nested: z.object({ name: z.string() }).strict(),
  };
  expect(parseBoundary(shape, { count: 1, nested: { name: "synthetic" } })).toEqual({
    count: 1,
    nested: { name: "synthetic" },
  });
  for (const input of [
    { count: 1, nested: { name: "x" }, secret: "private" },
    { count: 1, nested: { name: "x", private: "secret" } },
    { count: -1, nested: { name: "x" } },
  ]) {
    try {
      parseBoundary(shape, input);
      throw new Error("Should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(error)).not.toMatch(/private|secret/);
    }
  }
});
test("problem codes match normative OpenAPI and status determines retry behavior", async () => {
  const openapi = readFileSync(
    new URL("../../../docs/02-api/openapi.yaml", import.meta.url),
    "utf8",
  );
  const codes = /ProblemCode:\s+type: string\s+enum: \[([^\]]+)\]/u
    .exec(openapi)[1]
    .split(",")
    .map((code) => code.trim());
  expect(Object.keys(PROBLEM_DEFINITIONS).sort()).toEqual(codes.sort());
  for (const [code, definition] of Object.entries(PROBLEM_DEFINITIONS)) {
    const response = problemResponse(
      new ProblemError(code, { detail: "Bezpieczny opis" }),
      randomUUID(),
      base,
    );
    expect(response.status).toBe(definition.status);
    const body = await response.json();
    expect(body.title).toBe(definition.title);
    if (code === "INTERNAL") expect(body.detail).toBeUndefined();
    if ([429, 503].includes(response.status)) expect(response.headers.get("Retry-After")).toBe("1");
    else expect(response.headers.has("Retry-After")).toBe(false);
  }
  expect(
    problemResponse(
      new ProblemError("RATE_LIMITED", { retryAfterSeconds: 30 }),
      randomUUID(),
      base,
    ).headers.get("Retry-After"),
  ).toBe("30");
});
test("logger removes arbitrary nested inputs and masks email without mutating the input", () => {
  const { logger, lines } = capture();
  const input = {
    event: "request.completed",
    request_id: randomUUID(),
    status: 200,
    email: "alice@example.test",
    password: "private-password",
    totp: "123456",
    token: "private-token",
    amount: "98765.43",
    quantity: "654.321",
    req: {
      headers: { authorization: "private-auth", cookie: "private-cookie" },
      body: { files: "private-file" },
    },
    nested: [{ notes: "private-note", price: "332211.99" }],
    err: new Error("private-error"),
    msg: "private-freeform",
  };
  logger.info(input);
  const output = JSON.stringify(lines);
  for (const text of [
    "private-",
    "98765.43",
    "654.321",
    "332211.99",
    "alice@example.test",
    "123456",
  ])
    expect(output).not.toContain(text);
  expect(lines[0].email).toBe("a***@e***.test");
  expect(input.password).toBe("private-password");
  expect(() => logger.info("private-freeform")).toThrow();
});

test("problem constructor rejects unknown codes/options and invalid retry intervals", () => {
  expect(() => new ProblemError("toString")).toThrow(/Invalid problem code/);
  expect(() => new ProblemError("INTERNAL", { stack: "private-stack" })).toThrow(
    "Invalid problem options",
  );
  for (const value of [0, -1, 1.5, "private", Number.NaN]) {
    expect(() => new ProblemError("RATE_LIMITED", { retryAfterSeconds: value })).toThrow(
      "Invalid problem options",
    );
  }
});
