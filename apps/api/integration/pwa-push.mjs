import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createPushSender, dispatchNotification } from "@oliginvest/mod-notifications/jobs";
import { NotificationRepository, PushRepository } from "@oliginvest/mod-notifications/server";
import { sql } from "drizzle-orm";

export async function testPushStorage(database, context, other) {
  const repo = new PushRepository(database),
    preferences = new NotificationRepository(database);
  const make = () => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
    deviceLabel: "Synthetic device",
    expirationTime: Date.now() + 86400000,
  });
  const input = make(),
    key = randomUUID(),
    created = await repo.create(context, input, "Synthetic", key);
  assert.deepEqual(await repo.create(context, input, "Synthetic", key), created);
  assert.equal((await repo.list(other)).data.length, 0);
  await assert.rejects(
    () => repo.remove(other, created.id),
    (error) => error.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => repo.require(other, created.id),
    (error) => error.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => repo.create(other, input, "Synthetic", randomUUID()),
    (error) => error.code === "NOT_FOUND",
  );
  await assert.rejects(
    () => repo.create(context, { ...input, deviceLabel: "Different" }, "Synthetic", key),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    (await repo.create(context, { ...input, deviceLabel: "Changed" }, "Synthetic", randomUUID()))
      .id,
    created.id,
  );
  assert.equal((await repo.list(context)).data[0].deviceLabel, "Changed");
  await preferences.replace(context, {
    channels: { push: true, email: true },
    emailFallback: true,
    quietHours: null,
  });
  const calls = [],
    emails = [],
    sendEmail = async (...args) => emails.push(args);
  const vapid = { subject: "https://example.test", publicKey: "unused", privateKey: "unused" };
  const sender = createPushSender(vapid, async (...args) => {
    calls.push(args);
    return { statusCode: 201 };
  });
  const job = () => ({
    v: 1,
    userId: context.userId,
    kind: "alert",
    sourceRef: `alert:${randomUUID()}:${randomUUID()}`,
    channels: ["push"],
    subject: "Synthetic fact",
    text: "Synthetic source and timestamp",
    url: "/rynek/synthetic",
    occurredAt: new Date().toISOString(),
  });
  const event = job();
  await dispatchNotification(database, event, sendEmail, new Date(), true, sender);
  await dispatchNotification(database, event, sendEmail, new Date(), true, sender);
  assert.equal(calls.length, 1);
  assert.equal(emails.length, 0);
  assert.equal(calls[0][2].TTL, 3600);
  assert.equal(calls[0][2].urgency, "high");
  assert.equal(JSON.parse(calls[0][1]).url, event.url);
  assert.equal((await repo.list(context)).data[0].failureCount, 0);
  for (const statusCode of [404, 410]) {
    if (statusCode === 410) await repo.create(context, make(), "Synthetic", randomUUID());
    const expired = createPushSender(vapid, async () => {
      throw { statusCode, body: "must-not-store" };
    });
    const event = job();
    await dispatchNotification(database, event, sendEmail, new Date(), true, expired);
    await dispatchNotification(database, event, sendEmail, new Date(), true, expired);
    assert.equal((await repo.list(context)).data.length, 0);
  }
  assert.equal(emails.length, 2);
  const transient = await repo.create(context, make(), "Synthetic", randomUUID());
  const failing = createPushSender(vapid, async () => {
    throw { statusCode: 503 };
  });
  const failureEvent = job();
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(
      () => dispatchNotification(database, failureEvent, sendEmail, new Date(), true, failing),
      /NOTIFICATION_DELIVERY_FAILED/,
    );
  await dispatchNotification(database, failureEvent, sendEmail, new Date(), true, failing);
  assert.equal(emails.length, 3);
  assert.equal((await repo.list(context)).data[0].failureCount, 3);
  await repo.remove(context, transient.id);
  const timed = await repo.create(context, make(), "Synthetic", randomUUID());
  await database.transaction(context, (tx) =>
    tx.execute(
      sql`UPDATE notifications.push_subscriptions SET expires_at=now()-interval '1 second' WHERE id=${timed.id}::uuid`,
    ),
  );
  await dispatchNotification(database, job(), sendEmail, new Date(), true, sender);
  assert.equal(calls.length, 1);
  assert.equal(emails.length, 4);
  await repo.remove(context, timed.id);
  const quietSub = await repo.create(context, make(), "Synthetic", randomUUID());
  await preferences.replace(context, {
    channels: { push: true, email: true },
    emailFallback: true,
    quietHours: { start: "22:00", end: "07:00" },
  });
  const quiet = job(),
    night = new Date("2026-10-25T22:00:00Z");
  assert.ok(
    (await dispatchNotification(database, quiet, sendEmail, night, true, sender)).delayUntil,
  );
  assert.equal(calls.length, 1);
  await repo.remove(context, quietSub.id);
  // Security e-mail remains mandatory even when push expires and e-mail preferences are off.
  await preferences.replace(context, {
    channels: { push: true, email: false },
    emailFallback: false,
    quietHours: null,
  });
  await repo.create(context, make(), "Synthetic", randomUUID());
  const gone = createPushSender(vapid, async () => {
    throw { statusCode: 410 };
  });
  const security = { ...job(), kind: "security" };
  await dispatchNotification(database, security, sendEmail, new Date(), true, gone);
  await dispatchNotification(database, security, sendEmail, new Date(), true, gone);
  assert.equal(emails.length, 5);
  assert.equal(emails.at(-1)[3], true);
}
