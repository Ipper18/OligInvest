import { createHmac } from "node:crypto";

/** RFC 6238 code for the real-API browser runs (synthetic secrets from the enrolment screen). */
export function totp(base32: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...base32.replace(/=+$/, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return String((digest.readUInt32BE((digest[19] ?? 0) & 15) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
