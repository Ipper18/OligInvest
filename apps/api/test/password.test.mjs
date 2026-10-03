import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { checkPassword, hashPassword, needsRehash, verifyPassword } from "../dist/auth/password.js";

const safe = () => randomBytes(24).toString("base64url");
const subject = { email: "synthetic@example.test", name: "Example Person" };
const offline = { compromised: async () => false, unavailable: () => {} };

test("Argon2id verifies the complete password, uses fresh salts and detects stronger hashes", async () => {
  const password = safe();
  const a = await hashPassword(password);
  const b = await hashPassword(password);
  expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  expect(a).not.toBe(b);
  expect(await verifyPassword({ hash: a, password })).toBe(true);
  expect(await verifyPassword({ hash: a, password: `${password} ` })).toBe(false);
  expect(needsRehash(a)).toBe(false);
  expect(needsRehash(a.replace("m=19456", "m=65536"))).toBe(false);
  expect(needsRehash(a.replace("t=2", "t=1"))).toBe(true);
  expect(needsRehash("invalid")).toBe(true);
});

test.each([
  "short",
  "x".repeat(129),
  "oliginvest12345",
  "SYNTHETIC2026",
  "Example Person123",
  "unbelievable",
])("rejects weak/contextual password without consulting HIBP: %s", async (password) => {
  let checked = false;
  await expect(
    checkPassword(password, subject, {
      ...offline,
      compromised: async () => {
        checked = true;
        return false;
      },
    }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(checked).toBe(false);
});

test("HIBP compromise rejects; unavailable service keeps offline policy and reports only an event", async () => {
  const password = safe();
  await expect(
    checkPassword(password, subject, { ...offline, compromised: async () => true }),
  ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  let warnings = 0;
  await expect(
    checkPassword(password, subject, {
      compromised: async () => {
        throw new Error("synthetic provider outage");
      },
      unavailable: () => {
        warnings++;
      },
    }),
  ).resolves.toBeUndefined();
  expect(warnings).toBe(1);
});

test("preserves whitespace and case in the hashed password", async () => {
  const password = ` ${safe()} `;
  await checkPassword(password, subject, offline);
  const hash = await hashPassword(password);
  expect(await verifyPassword({ hash, password })).toBe(true);
  expect(await verifyPassword({ hash, password: password.trim() })).toBe(false);
});
