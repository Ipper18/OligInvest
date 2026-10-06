import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { ProviderError, ProviderLimits } from "../../../packages/data-providers/dist/index.js";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";

export async function testProviderLimits(env) {
  const connect = (kind) =>
    new Redis({
      host: env[`VALKEY_${kind}_HOST`],
      port: Number(env[`VALKEY_${kind}_PORT`]),
      username: env[`VALKEY_${kind}_USER`],
      password: env[`VALKEY_${kind}_JOBS_PASSWORD`],
      maxRetriesPerRequest: 0,
    });
  const queue = connect("QUEUE");
  const cache = connect("CACHE");
  const prefix = `test${randomBytes(8).toString("hex").replace(/\d/g, "z")}`;
  try {
    const limits = new ProviderLimits(queue, cache);
    let calls = 0;
    const answers = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        limits.run(prefix, { perMinute: 3, perDay: 4 }, async () => ++calls),
      ),
    );
    assert.equal(answers.filter((item) => item.status === "fulfilled").length, 3);
    assert.equal(calls, 3);
    const fresh = new ProviderLimits(queue, cache);
    await assert.rejects(
      () => fresh.run(prefix, { perMinute: 3, perDay: 4 }, async () => ++calls),
      ProviderError,
    );
    const broken = `${prefix}broken`;
    for (let i = 0; i < 5; i++)
      await assert.rejects(() =>
        limits.run(broken, {}, async () => {
          throw new ProviderError("provider_error");
        }),
      );
    await assert.rejects(
      () =>
        limits.run(broken, {}, async () => {
          throw new Error("must not call");
        }),
      (error) => error.reason === "provider_quota",
    );
    await queue.del(`breaker:${broken}`); // Advance OPEN to HALF_OPEN without a five-minute sleep.
    let release;
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const probe = limits.run(broken, {}, async () => {
      entered();
      await gate;
      return "recovered";
    });
    await ready;
    await assert.rejects(() => fresh.run(broken, {}, async () => "second probe"), ProviderError);
    release();
    assert.equal(await probe, "recovered");
    assert.equal(await fresh.run(broken, {}, async () => "closed"), "closed");
    await assert.rejects(() =>
      limits.run(`${prefix}rate`, {}, async () => {
        throw new ProviderError("provider_quota", 300_000, 429);
      }),
    );
    assert.equal(await queue.get(`breaker:${prefix}rate`), "open");
    let unlock;
    let started;
    const enteredFlight = new Promise((resolve) => {
      started = resolve;
    });
    const flightGate = new Promise((resolve) => {
      unlock = resolve;
    });
    const flight = limits.singleFlight(prefix, async () => {
      started();
      await flightGate;
    });
    await enteredFlight;
    await assert.rejects(() => fresh.singleFlight(prefix, async () => "duplicate"), ProviderError);
    unlock();
    await flight;
    await fresh.singleFlight(prefix, async () => "next");
    console.log(
      "Provider limits: atomic concurrent quota, persistent counters, 429 breaker, single HALF_OPEN probe and flight lease PASS",
    );
  } finally {
    await Promise.all([queue.quit(), cache.quit()]);
  }
}

if (process.argv.includes("--standalone")) {
  const dev = await isolatedEnvironment();
  try {
    compose(dev, ["up", "-d", "--wait", "valkey-queue", "valkey-cache"]);
    await testProviderLimits(applicationEnvironment(dev));
  } finally {
    compose(dev, ["down", "--volumes", "--remove-orphans"]);
  }
}
