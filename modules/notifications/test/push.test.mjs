import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPushSender, pushOptions } from "../src/push.ts";
import { validatePushSubscription } from "../src/server/push-repository.ts";

const input = () => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
});
describe("push subscriptions and transport", () => {
  it("accepts a browser subscription, rejects bad keys and expired timestamps", () => {
    expect(validatePushSubscription(input())).toBeDefined();
    for (const data of [
      { ...input(), keys: { p256dh: "x", auth: "x" } },
      { ...input(), expirationTime: 1 },
      { ...input(), unknown: true },
    ])
      expect(() => validatePushSubscription(data)).toThrow();
  });
  it.each([
    "https://updates.push.services.mozilla.com/wpush/v2/synthetic",
    "https://web.push.apple.com/synthetic",
    "https://wns2-synthetic.notify.windows.com/w/?token=synthetic",
  ])("accepts browser provider %s", (endpoint) =>
    expect(validatePushSubscription({ ...input(), endpoint })).toBeDefined(),
  );
  it.each([
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.evil.test/x",
    "https://evil.test/x",
    "https://user@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    "https://wns2.notify.windows.com.evil.test/w/",
    "https://a.b.notify.windows.com/w/",
  ])("rejects endpoint %s", (endpoint) =>
    expect(() => validatePushSubscription({ ...input(), endpoint })).toThrow(),
  );
  it.each([
    ["alert", 3600, "high"],
    ["security", 86400, "high"],
    ["system", 86400, "normal"],
  ])("%s has TTL and Urgency", (kind, TTL, urgency) =>
    expect(pushOptions(kind)).toEqual({ TTL, urgency }),
  );
  it.each([404, 410, 429, 500, 302])(
    "handles provider %s without persisting provider details",
    async (statusCode) => {
      const data = input(),
        updates = [];
      const tx = {
        execute: async (query) => {
          updates.push(query);
          return {
            rows:
              updates.length === 1
                ? [{ id: randomUUID(), endpoint: data.endpoint, ...data.keys, failure_count: 2 }]
                : [],
          };
        },
      };
      const send = createPushSender(
        { subject: "https://example.test", publicKey: "unused", privateKey: "unused" },
        async () => {
          throw { statusCode, body: "secret" };
        },
      );
      expect(
        await send(
          tx,
          { kind: "alert", subject: "Test", text: "Test", url: "/", sourceRef: "test" },
          new Date(),
        ),
      ).toEqual({ sent: false, retry: false });
      const { PgDialect } = await import("drizzle-orm/pg-core");
      const query = new PgDialect().sqlToQuery(updates[1]);
      expect(query.sql).toContain([404, 410].includes(statusCode) ? "DELETE" : "failure_count+1");
      expect(query.params).not.toContain("secret");
    },
  );
});
