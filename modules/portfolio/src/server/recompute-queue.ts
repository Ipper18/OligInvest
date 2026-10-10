import { recomputeJob } from "../contracts.js";

interface RecomputeQueue {
  add(
    name: string,
    data: unknown,
    options: {
      jobId?: string;
      attempts: number;
      backoff: { type: string; delay: number };
      removeOnComplete: boolean;
      removeOnFail: { age: number };
      deduplication?: { id: string; keepLastIfActive: boolean };
    },
  ): Promise<{ getState(): Promise<string> }>;
}
export async function enqueuePortfolioRecompute(queue: RecomputeQueue, raw: unknown) {
  const payload = recomputeJob.parse(raw);
  const options = {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { age: 86400 },
  };
  // An empty account list covers deleting the last account and nightly recovery.
  for (const accountId of payload.accountIds.length ? payload.accountIds : [payload.userId]) {
    const jobId = `recompute:${accountId}:${payload.fromDate}`;
    const data = { ...payload, accountIds: payload.accountIds.length ? [accountId] : [] };
    const job = await queue.add("portfolio.recompute", data, { ...options, jobId });
    const state = await job.getState();
    // A mutation committed after the running job's snapshot must get a successor.
    // A retained failed job must not suppress a later, valid operation either.
    if (["active", "completed", "failed", "unknown"].includes(state))
      await queue.add("portfolio.recompute", data, {
        ...options,
        deduplication: { id: `${jobId}:successor`, keepLastIfActive: true },
      });
  }
}
