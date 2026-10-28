import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { prepareDevelopment } from "../../../packages/db/scripts/prepare-development.mjs";
import {
  applicationEnvironment,
  compose,
  isolatedEnvironment,
} from "../../../scripts/dev-services.mjs";
import { createAuthMailer } from "../dist/auth-mail.js";
import { jobFeatureFlags } from "../dist/feature-flags.js";
import { reserveMail } from "../dist/mail-quota.js";
import { reportDay, startMonitoring } from "../dist/monitoring.js";
import { readRuntime } from "../dist/runtime.js";

const dev = await isolatedEnvironment();
const env = applicationEnvironment(dev);
let flags, monitor, mailer, queue;
const logger = { info() {}, warn() {}, error() {} };
try {
  compose(dev, ["up", "-d", "--wait"]);
  await prepareDevelopment(dev, env);
  const runtime = readRuntime(env);
  flags = jobFeatureFlags(env, runtime.config, logger);
  queue = new Queue("notify", { connection: runtime.connection });
  const quotaClient = await queue.getBackend().client;
  const quotaNow = Date.now();
  const quotaDay = Math.floor(quotaNow / 86400_000);
  mailer = createAuthMailer(runtime.config, "test", Number(env.SMTP_PORT), (security) =>
    reserveMail(
      async (key) => {
        const count = Number(await quotaClient.runCommand("incr", [key]));
        await quotaClient.runCommand("expire", [key, "172800"]);
        assert.ok(Number.isSafeInteger(count) && count > 0);
        return count;
      },
      security,
      quotaNow,
    ),
  );
  const delivered = [];
  let unavailable = true;
  const options = {
    connection: runtime.connection,
    cache: flags.cache,
    queues: [queue],
    database: flags.database,
    logger,
    host: "127.0.0.1",
    port: 0,
    send: async (email, subject, text) => {
      if (unavailable) throw new Error("SYNTHETIC_SMTP_OUTAGE");
      await mailer.sendReport(email, subject, text);
      delivered.push(text);
    },
  };
  monitor = await startMonitoring(options);
  const day = reportDay();
  const event = {
    source: "api",
    operation: "/api/v1/portfolio/accounts/:id",
    code: "INTERNAL",
    occurredAt: `${day}T12:00:00.000Z`,
    requestId: randomUUID(),
  };
  await Promise.all(Array.from({ length: 10 }, () => monitor.record(event)));
  await assert.rejects(monitor.record({ ...event, userId: randomUUID() }));
  const scheduler = (await queue.getJobSchedulers()).find(
    (s) => s.key === "monitoring.daily-report",
  );
  assert.equal(scheduler.pattern, "0 7 * * *");
  assert.equal(scheduler.tz, "Europe/Warsaw");
  const job = { name: "monitoring.daily-report", data: {}, opts: {}, timestamp: Date.now() };
  await assert.rejects(monitor.handle(job), /SMTP_OUTAGE/);
  await monitor.close();
  monitor = await startMonitoring(options);
  unavailable = false;
  await monitor.handle(job);
  assert.equal(delivered.length, 1);
  for (const bucket of ["ordinary", "total"])
    assert.equal(
      Number(await quotaClient.runCommand("get", [`quota:mail:${bucket}:${quotaDay}`])),
      1,
    );
  await quotaClient.runCommand("set", [`quota:mail:ordinary:${quotaDay}`, "250"]);
  await assert.rejects(
    mailer.sendReport("quota@example.invalid", "Limit", "Limit"),
    /MAIL_QUOTA_EXCEEDED/,
  );
  assert.equal(Number(await quotaClient.runCommand("get", [`quota:mail:total:${quotaDay}`])), 1);
  assert.match(delivered[0], /INTERNAL: 10/);
  assert.equal(delivered[0].split(event.requestId).length - 1, 3);
  await monitor.handle(job);
  assert.equal(delivered.length, 1);
  const origin = `http://127.0.0.1:${monitor.address.port}`;
  const metrics = await fetch(`${origin}/internal/metrics`);
  assert.equal(metrics.status, 200);
  const text = await metrics.text();
  for (const metric of [
    "queue_jobs",
    "db_pool_in_use",
    "valkey_used_memory_bytes",
    "provider_circuit_open",
    "provider_quota_remaining",
    "data_quality_issues_open",
  ])
    assert.match(text, new RegExp(metric));
  assert.equal((await fetch(`${origin}/unknown`)).status, 404);
  assert.doesNotMatch(text, new RegExp(event.requestId));
  console.log(
    "Monitoring: PostgreSQL + Valkey aggregation/restart/retry + Mailpit + internal metrics PASS",
  );
} finally {
  await monitor?.close();
  mailer?.close();
  flags?.cache.disconnect();
  await flags?.close();
  await queue?.close();
  compose(dev, ["down", "--volumes", "--remove-orphans"]);
}
