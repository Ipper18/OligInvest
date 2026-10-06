import { createHash, timingSafeEqual } from "node:crypto";

export function matchesBackupCode(codes: readonly string[], candidate: string): boolean {
  // Fixed-size digests allow comparison even when UTF-8 byte lengths differ.
  const provided = createHash("sha256").update(candidate).digest();
  let matches = 0;
  for (const code of codes) {
    const expected = createHash("sha256").update(code).digest();
    matches |= Number(timingSafeEqual(expected, provided));
  }
  return matches !== 0;
}
