import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { FeatureFlags, subscribeFeatureFlags } from "@oliginvest/platform";
import { Redis } from "ioredis";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";

export async function testFeatureFlags(env) {
  const connection = {
    host: env.VALKEY_CACHE_HOST,
    port: Number(env.VALKEY_CACHE_PORT),
    username: env.VALKEY_CACHE_USER,
    password: env.VALKEY_CACHE_JOBS_PASSWORD,
    maxRetriesPerRequest: 1,
    retryStrategy: null,
  };
  const publisher = new Redis(connection);
  const subscribers = [new Redis(connection), new Redis(connection)];
  let enabled = true;
  const flags = subscribers.map(
    () =>
      new FeatureFlags(async () => [
        { key: "module.analytics", enabled, rules: { roles: ["pro"] } },
      ]),
  );
  const subject = { userId: randomUUID(), role: "pro" };
  try {
    await Promise.all(
      subscribers.map((subscriber, i) => subscribeFeatureFlags(flags[i], subscriber)),
    );
    for (const instance of flags) {
      assert.equal(await instance.enabled("module.analytics", subject), true);
      assert.equal(await instance.enabled("module.analytics", { ...subject, role: "user" }), false);
    }
    enabled = false;
    await publisher.publish("flags.changed", JSON.stringify({ keys: ["module.analytics"] }));
    const deadline = Date.now() + 2000;
    while (
      (
        await Promise.all(flags.map((instance) => instance.enabled("module.analytics", subject)))
      ).some(Boolean)
    ) {
      assert.ok(Date.now() < deadline, "Both processes must invalidate before the 30-second TTL");
      await delay(10);
    }
    console.log(
      "Feature flags: real Valkey pub/sub invalidates both processes; per-role isolation PASS",
    );
  } finally {
    await Promise.all([publisher, ...subscribers].map((client) => client.quit()));
  }
}

if (process.argv.includes("--standalone")) {
  const dev = await isolatedEnvironment();
  try {
    compose(dev, ["up", "-d", "--wait", "valkey-cache"]);
    await testFeatureFlags(applicationEnvironment(dev));
  } finally {
    compose(dev, ["down", "--volumes", "--remove-orphans"]);
  }
}
