import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { FeatureFlags, permissionsForRole, requirePermission } from "../src/access.ts";

test("role matrix grants heavy analysis only to pro/admin and administration only to admin", () => {
  for (const role of ["user", "pro", "admin"]) {
    for (const key of [
      "market:read",
      "watchlists:write",
      "portfolio:read",
      "portfolio:write",
      "transactions:write",
      "alerts:manage",
      "analytics:run:light",
      "education:use",
    ])
      expect(() => requirePermission(role, key)).not.toThrow();
    for (const key of [
      "admin:users",
      "admin:flags",
      "admin:audit:read",
      "admin:queues",
      "admin:market",
      "admin:system",
    ])
      if (role === "admin") expect(() => requirePermission(role, key)).not.toThrow();
      else
        expect(() => requirePermission(role, key)).toThrowError(
          expect.objectContaining({ code: "FORBIDDEN" }),
        );
    if (role === "user")
      expect(() => requirePermission(role, "analytics:run:heavy")).toThrowError(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    else expect(() => requirePermission(role, "analytics:run:heavy")).not.toThrow();
    expect(permissionsForRole(role)).not.toContain("portfolio:read:others");
    expect(() => requirePermission(role, "unknown:permission")).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  }
  expect(() => requirePermission(undefined, "market:read")).toThrowError(
    expect.objectContaining({ code: "UNAUTHENTICATED" }),
  );
});

test("flags isolate subjects, enforce the parent switch and refresh after 30 seconds", async () => {
  let now = 0;
  let loads = 0;
  const user = randomUUID();
  const other = randomUUID();
  let rows = [
    { key: "module.analytics", enabled: true, rules: { roles: ["pro"], users: [user] } },
    { key: "module.analytics.backtest", enabled: true, rules: {} },
  ];
  const flags = new FeatureFlags(
    async () => {
      loads++;
      return rows;
    },
    () => now,
  );
  expect(await flags.enabled("module.analytics", { userId: user, role: "user" })).toBe(true);
  expect(await flags.enabled("module.analytics", { userId: other, role: "user" })).toBe(false);
  expect(await flags.enabled("module.analytics", { userId: other, role: "pro" })).toBe(true);
  expect(await flags.enabled("module.analytics.backtest", { userId: other, role: "user" })).toBe(
    false,
  );
  expect(loads).toBe(1);
  rows = [{ key: "module.analytics", enabled: false, rules: {} }];
  now = 29999;
  expect(await flags.enabled("module.analytics", { userId: user, role: "user" })).toBe(true);
  now = 30000;
  expect(await flags.enabled("module.analytics", { userId: user, role: "user" })).toBe(false);
  expect(loads).toBe(2);
  rows = [{ key: "module.analytics", enabled: true, rules: {} }];
  flags.invalidate();
  expect(await flags.enabled("module.analytics", { userId: user, role: "user" })).toBe(true);
  expect(loads).toBe(3);
});

test("invalidation during an in-flight load cannot restore stale cached flags", async () => {
  let release;
  let loads = 0;
  const flags = new FeatureFlags(async () => {
    loads++;
    if (loads === 1)
      await new Promise((r) => {
        release = r;
      });
    return [{ key: "module.analytics", enabled: loads !== 1, rules: {} }];
  });
  const subject = { userId: randomUUID(), role: "pro" };
  const stale = flags.enabled("module.analytics", subject);
  await Promise.resolve();
  flags.invalidate();
  release();
  await stale;
  expect(await flags.enabled("module.analytics", subject)).toBe(true);
  expect(loads).toBe(2);
});

test("fundamental modules cannot be disabled, admin remains role-bound; unknown or malformed flags fail closed", async () => {
  const subject = { userId: randomUUID(), role: "user" };
  const flags = new FeatureFlags(async () => [
    { key: "module.portfolio", enabled: false, rules: {} },
    { key: "module.admin", enabled: true, rules: {} },
  ]);
  expect(await flags.enabled("module.portfolio", subject)).toBe(true);
  expect(await flags.enabled("module.admin", subject)).toBe(false);
  expect(await flags.enabled("module.admin", { ...subject, role: "admin" })).toBe(true);
  expect(await flags.enabled("module.missing", subject)).toBe(false);
  await expect(
    new FeatureFlags(async () => [
      { key: "module.analytics", enabled: true, rules: { arbitrary: true } },
    ]).enabled("module.analytics", subject),
  ).rejects.toThrow();
  await expect(
    new FeatureFlags(async () => {
      throw new Error("database down");
    }).enabled("module.analytics", subject),
  ).rejects.toThrow();
});
