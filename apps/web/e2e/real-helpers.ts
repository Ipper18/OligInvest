import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

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

// The real API allows 5 auth calls per clock minute and 20 per hour for the shared loopback peer
// (apps/api/src/auth/state.ts). Specs record the minute of their last auth call; the next flow
// waits only while that minute lasts. Module state is per worker, so an unknown minute waits too.
let authMinute: number | undefined;
export function recordAuthCalls() {
  authMinute = Math.floor(Date.now() / 60000);
}
export async function freshAuthMinute() {
  if (authMinute === undefined || authMinute === Math.floor(Date.now() / 60000))
    await delay(60250 - (Date.now() % 60000));
}
