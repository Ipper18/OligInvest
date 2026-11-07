import { expect, test } from "vitest";
import { problemResponse } from "../src/problem.ts";
import { enforceDailyRoleQuota, resolveHeavyAnalysisLimit } from "../src/role-limits.ts";

test("heavy quota resolves each role without an admin bypass", () => {
  expect(resolveHeavyAnalysisLimit("user", undefined)).toBeNull();
  for (const role of ["pro", "admin"]) {
    expect(resolveHeavyAnalysisLimit(role, undefined)).toBe(20);
    expect(resolveHeavyAnalysisLimit(role, 0)).toBe(0);
    expect(resolveHeavyAnalysisLimit(role, 7)).toBe(7);
  }
  expect(() => resolveHeavyAnalysisLimit("owner", 20)).toThrow();
  for (const value of [null, -1, 1.5, "20", Infinity, NaN, 2 ** 53]) {
    expect(() => resolveHeavyAnalysisLimit("pro", value)).toThrow();
  }
});

const quota = {
  limit: 2,
  used: 1,
  observedAt: "2026-11-05T22:59:58.001Z",
  resetAt: "2026-11-05T23:00:00.000Z",
};

test("quota allows the last slot and rejects exhausted, zero and unavailable budgets", () => {
  expect(() => enforceDailyRoleQuota(quota)).not.toThrow();
  for (const [limit, used] of [
    [2, 2],
    [2, 3],
    [0, 0],
  ]) {
    expect(() => enforceDailyRoleQuota({ ...quota, limit, used })).toThrowError(
      expect.objectContaining({ code: "QUOTA_EXCEEDED", options: { retryAfterSeconds: 2 } }),
    );
  }
  expect(() => enforceDailyRoleQuota({ ...quota, limit: null })).toThrowError(
    expect.objectContaining({ code: "FORBIDDEN" }),
  );
});

test("quota refusal produces the existing RFC 9457 response with the actual reset delay", async () => {
  let error;
  try {
    enforceDailyRoleQuota({ ...quota, used: 2 });
  } catch (caught) {
    error = caught;
  }
  const response = problemResponse(error, "request-id", "https://example.test");
  expect(response.status).toBe(429);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBe("2");
  expect(await response.json()).toMatchObject({ status: 429, code: "QUOTA_EXCEEDED" });
});

test.each([
  ["2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", 23 * 3600],
  ["2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", 25 * 3600],
  ["2026-11-05T22:59:59.999Z", "2026-11-05T23:00:00Z", 1],
])("renewal delay for %s", (observedAt, resetAt, seconds) => {
  expect(() => enforceDailyRoleQuota({ ...quota, used: 2, observedAt, resetAt })).toThrowError(
    expect.objectContaining({ options: { retryAfterSeconds: seconds } }),
  );
});
