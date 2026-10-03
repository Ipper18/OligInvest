import { expect, test } from "vitest";
import { acceptedTotpStep, totpCode } from "../dist/auth/totp.js";

test("RFC 6238 SHA-1 vector uses the six rightmost digits", () => {
  expect(totpCode("12345678901234567890", 1)).toBe("287082");
});
test("accepts current and previous step only; rejects malformed codes and future steps", () => {
  const secret = "synthetic-totp-test-secret";
  const now = 1_800_000;
  const step = now / 30_000;
  expect(acceptedTotpStep(secret, totpCode(secret, step), now)).toBe(step);
  expect(acceptedTotpStep(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
  expect(acceptedTotpStep(secret, totpCode(secret, step + 1), now)).toBeNull();
  expect(acceptedTotpStep(secret, totpCode(secret, step - 2), now)).toBeNull();
  for (const code of ["00000", "0000000", "12345x", "123456 "])
    expect(acceptedTotpStep(secret, code, now)).toBeNull();
});
