import { createHmac, timingSafeEqual } from "node:crypto";

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(secret, "utf8")).update(counter).digest();
  const offset = (digest[19] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Better Auth encrypts raw UTF-8 secret bytes; the otpauth URI encodes them as base32.
export function acceptedTotpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (const candidate of [step, step - 1]) {
    if (
      candidate >= 0 &&
      timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code))
    )
      return candidate;
  }
  return null;
}
