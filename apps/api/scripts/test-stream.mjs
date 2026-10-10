import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ProblemError } from "@oliginvest/platform";
import { Redis } from "ioredis";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";
import { createApp } from "../dist/app.js";
import { StreamStore } from "../dist/stream-store.js";

const dev = await isolatedEnvironment();
const env = applicationEnvironment(dev);
let redis;
let administrator;
const streams = [];
try {
  compose(dev, ["up", "-d", "--wait", "valkey-cache"]);
  redis = new Redis({
    host: env.VALKEY_CACHE_HOST,
    port: Number(env.VALKEY_CACHE_PORT),
    password: env.VALKEY_CACHE_API_PASSWORD,
    maxRetriesPerRequest: 0,
  });
  administrator = redis;
  const acl = execFileSync(
    process.env.PYTHON_BIN || "python",
    [
      "-c",
      "import ast,hashlib,json,sys,pathlib; tree=ast.parse(pathlib.Path('infra/scripts/secret-files.py').read_text()); tree.body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='acl']; exec(compile(tree,'acl','exec')); print(acl({k:v.encode() for k,v in json.load(sys.stdin).items()},cache=True).decode())",
    ],
    {
      input: JSON.stringify({
        VALKEY_CACHE_API_PASSWORD: env.VALKEY_CACHE_API_PASSWORD,
        VALKEY_CACHE_JOBS_PASSWORD: env.VALKEY_CACHE_JOBS_PASSWORD,
      }),
      encoding: "utf8",
    },
  );
  for (const line of acl
    .split("\n")
    .filter((line) => line.startsWith("user api ") || line.startsWith("user jobs "))) {
    const [, name, ...permissions] = line.trim().split(" ");
    await administrator.call("ACL", "SETUSER", name, ...permissions);
  }
  redis = administrator.duplicate({ username: "api" });
  const store = new StreamStore(redis);
  const a = { userId: randomUUID(), sessionId: randomUUID() };
  const b = { userId: randomUUID(), sessionId: randomUUID() };
  const instrumentA = randomUUID(),
    instrumentB = randomUUID();
  const liveAccountA = randomUUID(),
    liveAccountB = randomUUID();
  const event = (id) => ({ event: "identity.export.ready", data: { v: 1, exportId: id } });
  const leases = await Promise.allSettled(Array.from({ length: 6 }, () => store.claim(a)));
  assert.equal(leases.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(leases.find((r) => r.status === "rejected").reason.code, "RATE_LIMITED");
  const ids = leases.filter((r) => r.status === "fulfilled").map((r) => r.value);
  await assert.rejects(
    () => store.replace(b, ids[0], [instrumentB]),
    (e) => e.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => store.replace({ ...a, sessionId: randomUUID() }, ids[0], [instrumentB]),
    (e) => e.code === "NOT_FOUND",
  );
  await store.release(b, ids[0]);
  assert.deepEqual(await store.instruments(a, ids[0]), []);
  await store.replace(a, ids[0], []);
  assert.deepEqual(await store.instruments(a, ids[0]), []);
  for (const id of ids) await store.release(a, id);
  const first = await store.publish(a.userId, event(randomUUID()));
  const second = await store.publish(a.userId, event(randomUUID()));
  assert.deepEqual(
    (await store.read(a.userId, first)).map((r) => r.id),
    [second],
  );
  assert.deepEqual(await store.read(b.userId, "0-0"), []);
  assert.equal((await store.resume(a.userId, first)).resumed, true);
  assert.equal((await store.resume(b.userId, first)).resumed, false);
  assert.equal((await store.resume(a.userId, "1-0")).resumed, false);
  await assert.rejects(() =>
    store.publish(a.userId, {
      ...event(randomUUID()),
      data: { v: 1, exportId: randomUUID(), secret: "not allowed" },
    }),
  );
  const revoked = new Set();
  let instant = Date.now();
  const app = createApp({
    checks: {},
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: "https://example.test",
    stream: {
      origin: "https://example.test",
      store: async () => store,
      now: () => instant,
      authorize: async (request) => {
        if (request.headers.has("authorization")) throw new ProblemError("FORBIDDEN");
        const token = request.headers.get("x-test-session");
        if (token === "mfa") throw new ProblemError("MFA_ENROLLMENT_REQUIRED");
        if (!["a", "b"].includes(token) || revoked.has(token))
          throw new ProblemError("UNAUTHENTICATED");
        return token === "a" ? a : b;
      },
      ownedInstruments: async (owner) => [owner.userId === a.userId ? instrumentA : instrumentB],
      valuation: async (owner) => ({
        v: 1,
        accountIds: [owner.userId === a.userId ? liveAccountA : liveAccountB],
        valuationAsOf: new Date().toISOString(),
        reason: "quotes",
      }),
    },
  });
  const get = (token, headers = {}) =>
    app.request("/api/v1/stream", {
      headers: { ...(token ? { "x-test-session": token } : {}), ...headers },
    });
  assert.equal((await get()).status, 401);
  assert.equal((await get("mfa")).status, 403);
  assert.equal((await get("a", { authorization: "Bearer synthetic" })).status, 403);
  async function open(token, headers = {}) {
    const response = await get(token, headers);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body.getReader();
    const frames = [];
    let buffer = "",
      done = false;
    const task = (async () => {
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          buffer += new TextDecoder().decode(item.value);
          while (buffer.includes("\n\n")) {
            const i = buffer.indexOf("\n\n");
            frames.push(buffer.slice(0, i));
            buffer = buffer.slice(i + 2);
          }
        }
      } finally {
        done = true;
      }
    })();
    const connection = {
      frames,
      close: async () => {
        await reader.cancel();
        await task;
      },
      done: () => done,
    };
    streams.push(connection);
    await until(() => frames.some((f) => f.includes("event: ready")));
    return connection;
  }
  async function until(predicate) {
    const deadline = Date.now() + 4000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error("SSE assertion timed out");
      await sleep(20);
    }
  }
  const sa = await open("a", { "Last-Event-ID": first }),
    sb = await open("b", { "Last-Event-ID": first });
  await until(() => sa.frames.some((f) => f.includes(`id: ${second}`)));
  assert.ok(sa.frames.some((f) => f.includes('"resumed":true')));
  assert.ok(sb.frames.some((f) => f.includes("event: resync")));
  assert.ok(!sb.frames.some((f) => f.includes(`id: ${second}`)));
  const ready = JSON.parse(sa.frames.find((f) => f.includes("event: ready")).split("data: ")[1]);
  const put = (token, instruments, origin = "https://example.test") =>
    app.request(`/api/v1/stream/connections/${ready.connectionId}/instruments`, {
      method: "PUT",
      headers: { "x-test-session": token, "content-type": "application/json", origin },
      body: JSON.stringify({ instrumentIds: instruments }),
    });
  assert.equal((await put("b", [instrumentA])).status, 404);
  assert.equal((await put("a", [], "https://foreign.test")).status, 403);
  assert.equal((await put("a", Array(51).fill(instrumentA))).status, 422);
  assert.equal((await put("a", [instrumentA, instrumentA])).status, 422);
  assert.equal((await put("a", [])).status, 204);
  const quote = (id) => ({
    instrumentId: id,
    price: "10.01",
    currency: "PLN",
    source: "yahoo",
    asOf: new Date().toISOString(),
    delayMinutes: 15,
    stale: false,
  });
  await redis.publish(
    "sse:quotes",
    JSON.stringify({ v: 1, quotes: [quote(instrumentA), quote(instrumentB)] }),
  );
  await until(
    () =>
      sa.frames.some((f) => f.includes("market.quotes.updated")) &&
      sb.frames.some((f) => f.includes("market.quotes.updated")),
  );
  assert.ok(!sa.frames.some((f) => f.includes(instrumentB)));
  assert.ok(!sb.frames.some((f) => f.includes(instrumentA)));
  await until(
    () =>
      sa.frames.some((f) => f.includes(liveAccountA)) &&
      sb.frames.some((f) => f.includes(liveAccountB)),
  );
  assert.ok(!sa.frames.some((f) => f.includes(liveAccountB)));
  assert.ok(!sb.frames.some((f) => f.includes(liveAccountA)));
  assert.ok(!sa.frames.find((f) => f.includes(liveAccountA)).includes("id:"));
  // Irrelevant batches cannot crowd an allowed quote out of the connection buffer.
  for (let batch = 0; batch < 2; batch++)
    await redis.publish(
      "sse:quotes",
      JSON.stringify({ v: 1, quotes: Array.from({ length: 200 }, () => quote(randomUUID())) }),
    );
  await redis.publish(
    "sse:quotes",
    JSON.stringify({ v: 1, quotes: [{ ...quote(instrumentA), price: "10.02" }] }),
  );
  instant += 2001;
  await until(() => sa.frames.filter((f) => f.includes(liveAccountA)).length === 2);
  assert.equal(
    sa.frames.filter((f) => f.includes("market.quotes.updated")).length,
    1,
    "valuation must not wait for quote throttle",
  );
  instant += 3000;
  await until(() => sa.frames.some((f) => f.includes("10.02")));
  assert.equal(sa.frames.filter((f) => f.includes("market.quotes.updated")).length, 2);
  const accountA = randomUUID(),
    accountB = randomUUID();
  const valuation = (account) => ({
    event: "portfolio.valuation.updated",
    data: { v: 1, accountIds: [account], valuationAsOf: new Date().toISOString(), reason: "eod" },
  });
  await store.publish(a.userId, valuation(accountA));
  await until(() => sa.frames.some((f) => f.includes('"reason":"eod"')));
  await store.publish(a.userId, valuation(accountA));
  const lastValuation = await store.publish(a.userId, valuation(accountB));
  await sleep(300);
  assert.equal(sa.frames.filter((f) => f.includes('"reason":"eod"')).length, 1);
  instant += 2001;
  await until(() => sa.frames.some((f) => f.includes(`id: ${lastValuation}`)));
  const merged = sa.frames.find((f) => f.includes(`id: ${lastValuation}`));
  assert.ok(merged.includes(accountA) && merged.includes(accountB));
  assert.ok(!sb.frames.some((f) => f.includes(accountA) || f.includes(accountB)));
  instant += 25001;
  await until(() => sa.frames.some((f) => f.includes("event: ping")));
  revoked.add("a");
  await redis.publish("sse:auth", JSON.stringify({ v: 1 }));
  await until(() => sa.done());
  assert.ok(sa.frames.some((f) => f.includes("auth.session.revoked")));
  assert.ok(!sb.done());
  const held = await Promise.all(Array.from({ length: 4 }, () => store.claim(b)));
  const limited = await get("b");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  for (const id of held) await store.release(b, id);
  await sb.close();
  await until(async () => (await redis.zcard(`sse:connections:${b.userId}`)) === 0);
  assert.equal(await redis.zcard(`sse:connections:${b.userId}`), 0);
  console.log(
    "SSE real Valkey: isolation, replay/gap, auth/MFA/PAT, CSRF, limits, coalescing, heartbeat, revocation and cleanup PASS",
  );
} finally {
  await Promise.allSettled(streams.map((s) => s.close()));
  redis?.disconnect();
  administrator?.disconnect();
  compose(dev, ["down", "--volumes", "--remove-orphans"]);
}
