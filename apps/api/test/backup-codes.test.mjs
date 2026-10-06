import { createHash, timingSafeEqual } from "node:crypto";
import { expect, test, vi } from "vitest";

vi.mock("node:crypto", async (original) => {
  const crypto = await original();
  return { ...crypto, timingSafeEqual: vi.fn(crypto.timingSafeEqual) };
});
const { matchesBackupCode } = await import("../dist/auth/backup-codes.js");

test.each(["first-code", "middle-code", "last-code", "absent", "", "ą".repeat(16)])(
  "compares every backup code with fixed-size buffers: %s",
  (candidate) => {
    const codes = ["first-code", "middle-code", "last-code"];
    vi.mocked(timingSafeEqual).mockClear();
    expect(matchesBackupCode(codes, candidate)).toBe(codes.includes(candidate));
    expect(timingSafeEqual).toHaveBeenCalledTimes(codes.length);
    for (const [index, [left, right]] of vi.mocked(timingSafeEqual).mock.calls.entries()) {
      expect(left).toEqual(createHash("sha256").update(codes[index]).digest());
      expect(right).toEqual(createHash("sha256").update(candidate).digest());
      expect(left.length).toBe(32);
      expect(right.length).toBe(32);
    }
  },
);

test("an exhausted list cannot accept a backup code", () => {
  expect(matchesBackupCode([], "first-code")).toBe(false);
});
