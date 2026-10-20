import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyticsJobSchema, analyticsResultSchema } from "@oliginvest/contracts";
import { Queue } from "bullmq";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
  repository,
  run,
} from "../../../scripts/dev-services.mjs";
import { checkHealth, readRuntime, startJobs } from "../dist/index.js";
import { marketSchedules } from "../dist/modules.js";
import { testFeatureFlags } from "./test-feature-flags.mjs";
import { testProviderLimits } from "./test-provider-limits.mjs";
import { testRecomputeQueue } from "./test-recompute-queue.mjs";

const dev = await isolatedEnvironment();
const env = applicationEnvironment(dev);
let jobs;
let queue;
let analytics;
let results;
try {
  console.log("Starting isolated Valkey from compose.dev.yaml");
  compose(dev, ["up", "-d", "--wait", "valkey-queue", "valkey-cache"]);
  await testFeatureFlags(env);
  await testProviderLimits(env);
  jobs = await startJobs(env);
  assert.equal(jobs.queues.length, 8);
  const ingest = jobs.queues.find((q) => q.name === "ingest");
  const before = await ingest.getJobSchedulers();
  assert.equal(before.length, marketSchedules.length);
  for (const schedule of marketSchedules) {
    const item = before.find((item) => item.key === schedule.job);
    assert.equal(item.pattern, schedule.cron);
    assert.equal(item.tz, schedule.tz);
    await ingest.upsertJobScheduler(
      schedule.job,
      { pattern: schedule.cron, tz: schedule.tz },
      { name: schedule.job, data: {} },
    );
  }
  assert.equal((await ingest.getJobSchedulers()).length, marketSchedules.length);
  assert.equal(await checkHealth(env), true);
  const runtime = readRuntime(env);
  const recompute = jobs.queues.find((q) => q.name === "recompute");
  const nightly = (await recompute.getJobSchedulers()).find(
    (s) => s.key === "portfolio.recompute-all",
  );
  assert.equal(nightly.pattern, "0 3 * * *");
  assert.equal(nightly.tz, "Europe/Warsaw");
  await testRecomputeQueue(runtime.connection);
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
  // BL-311: Zod-built jobs cross Valkey and are validated again by the Python worker.
  const cases = JSON.parse(
    readFileSync(resolve(repository, "packages/contracts/test/fixtures/analytics-job-cases.json")),
  );
  analytics = new Queue("analytics", { connection: runtime.connection });
  results = new Queue("analytics-results", { connection: runtime.connection });
  const valid = analyticsJobSchema.parse({ ...cases.bases.monte_carlo, runId: randomUUID() });
  const overLimit = { ...valid, runId: randomUUID(), params: { ...valid.params, paths: 10001 } };
  for (const item of [valid, overLimit])
    await analytics.add(item.type, item, { jobId: item.runId, attempts: 1 });
  const anonymous = await analytics.add("monte_carlo", { runId: "unknown" }, { attempts: 1 });
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
      env: {
        ...process.env,
        ...env,
        OLIGINVEST_QUEUE_TEST: JSON.stringify(payload),
        OLIGINVEST_ANALYTICS_TEST: JSON.stringify([valid.runId, overLimit.runId, anonymous.id]),
      },
      log: "queues.log",
      cwd: repository,
      timeout: 60000,
    },
  );
  assert.equal(await job.getState(), "completed");
  assert.deepEqual((await queue.getJob(job.id)).returnvalue, { ...payload, received: true });
  for (const [item, code] of [
    [valid, "INTERNAL"],
    [overLimit, "INVALID_PARAMS"],
  ]) {
    const consumed = await analytics.getJob(item.runId);
    assert.equal(await consumed.getState(), "completed");
    assert.deepEqual(consumed.returnvalue, { v: 1, runId: item.runId, status: "failed" });
    const result = analyticsResultSchema.parse((await results.getJob(item.runId)).data);
    assert.equal(result.error.code, code);
  }
  const rejected = await analytics.getJob(anonymous.id);
  assert.equal(await rejected.getState(), "failed");
  assert.equal(rejected.failedReason, "Invalid analytics job");
  assert.equal(await results.getJob(anonymous.id), undefined);
  console.log(
    "Queue catalog, health (including stale/bad credentials), Node -> Python ACK, analytics contract, socket guard: PASS",
  );
} finally {
  try {
    await Promise.allSettled([queue?.close(), analytics?.close(), results?.close(), jobs?.close()]);
    if (jobs) assert.equal(await checkHealth(env), false);
  } finally {
    compose(dev, ["down", "--volumes", "--remove-orphans"]);
  }
}
