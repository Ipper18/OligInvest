import { expect, test } from "vitest";
import { proxyTarget } from "./proxy-target.mjs";

test("proxy preserves the configured origin and only copies path and query", () => {
  const target = proxyTarget("/api/v1/portfolio?cursor=a%2Fb", "http://127.0.0.1:4010/base");
  expect(target.href).toBe("http://127.0.0.1:4010/api/v1/portfolio?cursor=a%2Fb");
});

test("proxy rejects authority, schemes and ambiguous request targets", () => {
  for (const path of [
    "//evil.test/api/v1",
    "https://evil.test/api/v1",
    "/api/https://evil.test",
    "/\\evil.test/api",
    "/api/\n//evil.test",
    "api/v1",
    undefined,
  ])
    expect(() => proxyTarget(path, "http://127.0.0.1:4010")).toThrow();
  for (const path of ["/api//evil.test", "/api/%2f%2fevil.test", "/api/../v1?a=b"])
    expect(proxyTarget(path, "http://127.0.0.1:4010").origin).toBe("http://127.0.0.1:4010");
});
