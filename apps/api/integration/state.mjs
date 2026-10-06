import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { RedisAuthState } from "../dist/auth/state.js";

export async function testAuthState(env) {
  const client = new Redis({
    host: env.VALKEY_QUEUE_HOST,
    port: Number(env.VALKEY_QUEUE_PORT),
    username: env.VALKEY_QUEUE_USER,
    password: env.VALKEY_QUEUE_API_PASSWORD,
    maxRetriesPerRequest: 0,
    retryStrategy: null,
  });
  const state = new RedisAuthState(client);
  const subject = randomUUID();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => state.limit(subject, 5, 3600)),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
    assert.ok(
      results
        .filter((result) => result.status === "rejected")
        .every((result) => result.reason.code === "RATE_LIMITED"),
    );
    await Promise.all(Array.from({ length: 6 }, () => state.failed(subject)));
    assert.equal(await state.failures(subject), 6);
    await state.succeeded(subject);
    assert.equal(await state.failures(subject), 0);
    assert.equal(await state.consumeStep(subject, 10), true);
    assert.equal(await state.consumeStep(subject, 10), false);
    assert.equal(await state.consumeStep(subject, 9), false);
    assert.equal(await state.consumeStep(subject, 11), true);
    for (const key of await client.keys("auth:*")) assert.ok((await client.ttl(key)) > 0);
    console.log(
      "Auth state: concurrent rate limits, expiring counters and TOTP replay on Valkey PASS",
    );
  } finally {
    await client.quit();
  }
}
