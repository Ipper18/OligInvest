import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker } from "bullmq";
import { enqueuePortfolioRecompute } from "../dist/modules.js";

export async function testRecomputeQueue(connection) {
  const queue = new Queue("recompute-smoke", { connection });
  const payload = {
    userId: randomUUID(),
    accountIds: [randomUUID()],
    fromDate: "2025-01-01",
    reason: "transactions",
  };
  let worker;
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  const seen = [];
  try {
    await enqueuePortfolioRecompute(queue, payload);
    await enqueuePortfolioRecompute(queue, payload);
    assert.equal(await queue.getWaitingCount(), 1);
    const { commandTimeout: _t, ...workerConnection } = connection;
    worker = new Worker(
      queue.name,
      async (job) => {
        seen.push(job.data);
        if (seen.length === 1) {
          started.resolve();
          await release.promise;
        }
      },
      { connection: { ...workerConnection, maxRetriesPerRequest: null } },
    );
    await worker.waitUntilReady();
    await Promise.race([
      started.promise,
      sleep(4000).then(() => {
        throw new Error("Recompute never started");
      }),
    ]);
    await enqueuePortfolioRecompute(queue, { ...payload, reason: "import" });
    await enqueuePortfolioRecompute(queue, { ...payload, reason: "import" });
    assert.equal(
      await queue.getWaitingCount(),
      1,
      "one successor after a mutation during active replay",
    );
    release.resolve();
    const deadline = Date.now() + 4000;
    while (seen.length < 2 || (await queue.getActiveCount())) {
      assert(Date.now() < deadline, "successor must finish within five seconds");
      await sleep(20);
    }
    assert.equal(seen.length, 2);
    assert.equal(seen[1].reason, "import");
    await enqueuePortfolioRecompute(queue, payload);
    while (seen.length < 3) {
      assert(Date.now() < deadline);
      await sleep(20);
    }
  } finally {
    release.resolve();
    await worker?.close();
    await queue.close();
  }
}
