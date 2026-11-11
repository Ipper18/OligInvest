import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { enqueueRetention, RETENTION_JOB } from "../dist/retention-runtime.js";

/** BL-115: at most one retention job waits or runs, across repeated nightly triggers. */
export async function testRetentionQueue(connection) {
  const queue = new Queue("retention-smoke", { connection });
  let worker;
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  let runs = 0;
  try {
    await enqueueRetention(queue);
    await enqueueRetention(queue);
    assert.equal(await queue.getWaitingCount(), 1, "duplicate trigger while waiting");
    const { commandTimeout: _t, ...workerConnection } = connection;
    worker = new Worker(
      queue.name,
      async (job) => {
        assert.equal(job.name, RETENTION_JOB);
        runs += 1;
        started.resolve();
        await release.promise;
      },
      { connection: { ...workerConnection, maxRetriesPerRequest: null }, concurrency: 2 },
    );
    await worker.waitUntilReady();
    await Promise.race([
      started.promise,
      sleep(4000).then(() => {
        throw new Error("Retention never started");
      }),
    ]);
    await enqueueRetention(queue);
    assert.equal(await queue.getWaitingCount(), 0, "no second run while one is active");
    release.resolve();
    const deadline = Date.now() + 4000;
    while (await queue.getActiveCount()) {
      assert(Date.now() < deadline, "retention must finish within four seconds");
      await sleep(20);
    }
    await enqueueRetention(queue);
    while (runs < 2) {
      assert(Date.now() < deadline + 4000, "next trigger after completion runs again");
      await sleep(20);
    }
    assert.equal(runs, 2);
  } finally {
    release.resolve();
    await worker?.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
}
