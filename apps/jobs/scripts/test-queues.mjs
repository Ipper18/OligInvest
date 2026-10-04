import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
  repository,
  run,
} from "../../../scripts/dev-services.mjs";
import { checkHealth, readRuntime, startJobs } from "../dist/index.js";
import { testFeatureFlags } from "./test-feature-flags.mjs";

const dev = await isolatedEnvironment();
const env = applicationEnvironment(dev);
let jobs;
let queue;
try {
  console.log("Starting isolated Valkey from compose.dev.yaml");
  compose(dev, ["up", "-d", "--wait", "valkey-queue", "valkey-cache"]);
  await testFeatureFlags(env);
  jobs = await startJobs(env);
  assert.equal(jobs.queues.length, 8);
  assert.equal(await checkHealth(env), true);
  const runtime = readRuntime(env);
  const client = await jobs.queues[0].getBackend().client;
  const info = await client.info();
  assert.match(info, /maxmemory_policy:noeviction/u);
  assert.match(info, /aof_enabled:1/u);
  await client.set(runtime.heartbeatKey, String(Date.now() - 11000));
  assert.equal(await checkHealth(env), false);
  await client.set(runtime.heartbeatKey, String(Date.now()));
  assert.equal(await checkHealth({ ...env, JOBS_INSTANCE_ID: "absent" }), false);
  assert.equal(await checkHealth({ ...env, VALKEY_QUEUE_JOBS_PASSWORD: "invalid" }), false);
  queue = new Queue("analytics-smoke", { connection: runtime.connection });
  const payload = { version: 1, requestId: randomUUID() };
  const job = await queue.add("ping", payload, { jobId: payload.requestId });
  run(
    process.env.UV_BIN || "uv",
    [
      "run",
      "--frozen",
      "--offline",
      "--project",
      "apps/analytics",
      "pytest",
      "-q",
      "apps/analytics/test/test_worker.py",
    ],
    {
      env: { ...process.env, ...env, OLIGINVEST_QUEUE_TEST: JSON.stringify(payload) },
      log: "queues.log",
      cwd: repository,
      timeout: 60000,
    },
  );
  assert.equal(await job.getState(), "completed");
  assert.deepEqual((await queue.getJob(job.id)).returnvalue, { ...payload, received: true });
  console.log(
    "Queue catalog, health (including stale/bad credentials), Node -> Python ACK, socket guard: PASS",
  );
} finally {
  try {
    await Promise.allSettled([queue?.close(), jobs?.close()]);
    if (jobs) assert.equal(await checkHealth(env), false);
  } finally {
    compose(dev, ["down", "--volumes", "--remove-orphans"]);
  }
}
