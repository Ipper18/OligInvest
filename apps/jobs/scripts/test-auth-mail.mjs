import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Queue } from "bullmq";
import { readRuntime } from "../dist/runtime.js";

export async function testQueuedAuthMail(env, httpPort) {
  const queue = new Queue("notify", { connection: readRuntime(env).connection });
  const email = `${randomUUID()}@example.test`;
  const token = randomUUID();
  try {
    const job = await queue.add("auth.password-reset", {
      email,
      token,
      issuedAt: new Date().toISOString(),
    });
    const deadline = Date.now() + 10000;
    while ((await job.getState()) !== "completed") {
      assert.notEqual(await job.getState(), "failed", "Mail job failed");
      assert.ok(Date.now() < deadline, "Mail job did not complete");
      await delay(50);
    }
    const host = env.SMTP_HOST.includes(":") ? `[${env.SMTP_HOST}]` : env.SMTP_HOST;
    const base = `http://${host}:${httpPort}`;
    const messages = await (await fetch(`${base}/api/v1/messages`)).json();
    const message = messages.messages.find((entry) =>
      entry.To.some((recipient) => recipient.Address === email),
    );
    assert.ok(message, "Worker must deliver to local Mailpit");
    const delivered = await (await fetch(`${base}/api/v1/message/${message.ID}`)).json();
    assert.ok(delivered.Text.includes(`#t=${token}`));
    assert.ok(!delivered.Text.includes(`?t=${token}`));
    await job.remove();
    console.log("Queue -> auth mail worker -> Mailpit with fragment-only token: PASS");
  } finally {
    await queue.close();
  }
}
