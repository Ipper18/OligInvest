import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { readSignedCookie, SESSION_COOKIE, sessionCookie } from "../dist/auth/session.js";

const secrets = [3, 2, 1].map((version) => ({ version, value: randomBytes(32).toString("hex") }));
const configuration = { secrets };
const request = (cookie) => new Request("https://example.test", { headers: { cookie } });
const signed = (name, token, secret) =>
  `${name}=${encodeURIComponent(`${token}.${createHmac("sha256", secret.value).update(token).digest("base64")}`)}`;

test.each([SESSION_COOKIE, "__Host-oliginvest.two_factor", "__Host-oliginvest.dont_remember"])(
  "accepts each retained signing version for %s and rejects removed versions",
  (name) => {
    for (const secret of secrets) {
      const cookie = request(signed(name, "synthetic-value", secret));
      expect(readSignedCookie(cookie, name, configuration)).toBe("synthetic-value");
      expect(
        readSignedCookie(cookie, name, { secrets: secrets.filter((s) => s !== secret) }),
      ).toBeNull();
    }
  },
);

test("new session cookies are signed only by the first (newest) secret", () => {
  const cookie = sessionCookie("synthetic-value", configuration, true).split(";")[0];
  expect(cookie).toBe(signed(SESSION_COOKIE, "synthetic-value", secrets[0]));
  expect(
    readSignedCookie(request(cookie), SESSION_COOKIE, { secrets: secrets.slice(1) }),
  ).toBeNull();
});

test("rotation still rejects tampering, unknown signatures, duplicates and malformed cookies", () => {
  const good = signed(SESSION_COOKIE, "synthetic-value", secrets[1]);
  for (const cookie of [
    "",
    good.replace("synthetic-value", "changed-value"),
    signed(SESSION_COOKIE, "synthetic-value", { value: randomBytes(32).toString("hex") }),
    `${good}; ${good}`,
    `${SESSION_COOKIE}=%ZZ`,
    `${SESSION_COOKIE}=unsigned`,
    `${SESSION_COOKIE}=value.short`,
    `${SESSION_COOKIE}=value.${"x".repeat(44)}`,
  ])
    expect(readSignedCookie(request(cookie), SESSION_COOKIE, configuration)).toBeNull();
});
