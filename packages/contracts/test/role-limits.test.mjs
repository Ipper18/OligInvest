import { expect, test } from "vitest";
import { dailyRoleQuotaSchema } from "../src/role-limits.ts";

const quota = {
  role: "pro",
  limit: 20,
  used: 0,
  observedAt: "2026-11-05T12:00:00Z",
  resetAt: "2026-11-05T23:00:00Z",
};

test("quota contract accepts every role, zero, null and exhausted quotas", () => {
  for (const role of ["user", "pro", "admin"]) {
    for (const limit of [null, 0, 20]) {
      expect(dailyRoleQuotaSchema.parse({ ...quota, role, limit, used: 21 }).limit).toBe(limit);
    }
  }
});

test("quota contract rejects malformed counts, timestamps, roles and extra fields", () => {
  for (const patch of [
    { role: "owner" },
    { limit: -1 },
    { limit: 1.5 },
    { limit: "20" },
    { used: -1 },
    { used: 2 ** 53 },
    { resetAt: "tomorrow" },
    { resetAt: quota.observedAt },
    { observedAt: "2026-11-06T12:00:00Z" },
    { extra: true },
  ])
    expect(dailyRoleQuotaSchema.safeParse({ ...quota, ...patch }).success).toBe(false);
});
