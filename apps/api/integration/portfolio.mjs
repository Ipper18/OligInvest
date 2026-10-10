import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";
import { PortfolioRepository } from "../dist/modules.js";

export async function testPortfolioStorage(settings) {
  const options = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAppDatabase({ ...options, password: settings.passwords.app });
  const auth = createAuthDatabase({ ...options, password: settings.passwords.auth });
  const userId = randomUUID(),
    otherId = randomUUID(),
    instrumentId = randomUUID();
  const events = [];
  const owner = { userId, role: "user" },
    other = { userId: otherId, role: "admin" };
  const repository = new PortfolioRepository(database, async (payload) => {
    // The enqueue callback must observe committed data from a separate connection.
    await database.transaction(owner, async (tx) => {
      await tx.execute(sql`SELECT count(*) FROM portfolio.transactions`);
    });
    events.push(payload);
  });
  const app = createApp({
    checks: {},
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: "https://example.test",
    portfolio: {
      repository: () => repository,
      authorize: async (request, stepUp) => {
        if (stepUp && request.headers.get("x-step-up") !== "yes")
          throw new ProblemError("STEP_UP_REQUIRED");
        const who = request.headers.get("x-owner");
        if (who === "a") return owner;
        if (who === "b") return other;
        throw new ProblemError("UNAUTHENTICATED");
      },
      assertOrigin: (request) => {
        if (request.method !== "GET" && request.headers.get("origin") !== "https://example.test")
          throw new ProblemError("FORBIDDEN");
      },
    },
  });
  const request = (path, method = "GET", data, headers = {}) =>
    app.request("/api/v1/portfolio/" + path, {
      method,
      headers: {
        "x-owner": "a",
        origin: "https://example.test",
        "content-type": "application/json",
        ...headers,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  try {
    await auth.transaction(async (tx) => {
      for (const id of [userId, otherId])
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email)VALUES(${id}::uuid,'Synthetic portfolio test',${`${id}@example.invalid`})`,
        );
    });
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency)VALUES(${instrumentId}::uuid,'XWAR',${`T${instrumentId.slice(0, 8)}`},'Synthetic','stock','PLN')`,
      );
    });
    assert.equal((await request("accounts", "GET", undefined, { "x-owner": "" })).status, 401);
    assert.equal(
      (await request("accounts", "POST", {}, { origin: "https://other.invalid" })).status,
      403,
    );
    const created = await request("accounts", "POST", {
      name: "Synthetic regular",
      broker: "xtb",
      accountType: "regular",
      currency: "PLN",
    });
    assert.equal(created.status, 201);
    const account = await created.json();
    assert.equal(
      (await request(`accounts/${account.id}`, "GET", undefined, { "x-owner": "b" })).status,
      404,
    );
    for (const accountType of ["ike", "ikze"])
      assert.equal(
        (
          await request("accounts", "POST", {
            name: accountType,
            broker: "xtb",
            accountType,
            currency: "PLN",
          })
        ).status,
        201,
      );
    const buy = {
      accountId: account.id,
      type: "BUY",
      tradeDate: "2025-03-03",
      settleDate: "2025-03-05",
      instrumentId,
      quantity: "10",
      price: "20",
      priceCurrency: "PLN",
    };
    const key = randomUUID();
    await database.transaction(owner, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`portfolio-idempotency:${userId}:${key}`},0))`,
      );
      const conflict = await request("transactions", "POST", buy, { "Idempotency-Key": key });
      assert.equal(conflict.status, 409);
      assert.equal(conflict.headers.get("Retry-After"), "1");
    });
    const responses = await Promise.all([
      request("transactions", "POST", buy, { "Idempotency-Key": key }),
      request("transactions", "POST", buy, { "Idempotency-Key": key }),
    ]);
    assert(responses.every((r) => [201, 409].includes(r.status)));
    const successful = responses.find((r) => r.status === 201);
    assert(successful);
    const replay = await request("transactions", "POST", buy, { "Idempotency-Key": key });
    assert.equal(replay.status, 201);
    assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
    const [first, second] = await Promise.all([successful.json(), replay.json()]);
    assert.equal(first.id, second.id);
    assert.equal(first.amount.amount, "-200.00000000");
    for (const method of ["GET", "PATCH", "DELETE"]) {
      assert.equal(
        (
          await request(
            `transactions/${first.id}`,
            method,
            method === "PATCH" ? { quantity: "100" } : undefined,
            { "x-owner": "b" },
          )
        ).status,
        404,
      );
    }
    assert.equal(
      (await request("transactions", "POST", { ...buy, quantity: "9" }, { "Idempotency-Key": key }))
        .status,
      409,
    );
    assert.equal(
      (
        await request(
          "transactions",
          "POST",
          { ...buy, quantity: "100", type: "SELL" },
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await request("transactions", "POST", buy, {
          "Idempotency-Key": randomUUID(),
          "x-owner": "b",
        })
      ).status,
      404,
    );
    const sell = await request(
      "transactions",
      "POST",
      {
        ...buy,
        tradeDate: "2025-03-06",
        settleDate: "2025-03-10",
        type: "SELL",
        quantity: "4",
        price: "25",
      },
      { "Idempotency-Key": randomUUID() },
    );
    assert.equal(sell.status, 201);
    assert.equal((await request(`transactions/${first.id}`, "DELETE")).status, 422);
    assert.equal(
      (await request(`transactions/${first.id}`, "PATCH", { quantity: "2" })).status,
      422,
    );
    const unchanged = await (await request(`transactions/${first.id}`)).json();
    assert.equal(unchanged.quantity, "10.0000000000");
    assert.equal(unchanged.amount.amount, "-200.00000000");
    assert.equal(
      (await (await request("transactions", "GET", undefined, { "x-owner": "b" })).json()).data
        .length,
      0,
    );
    const page = await (await request("transactions?limit=1")).json();
    assert.equal(page.data.length, 1);
    assert.equal(page.page.hasMore, true);
    const next = await (
      await request(`transactions?limit=1&cursor=${page.page.nextCursor}`)
    ).json();
    assert.equal(next.data.length, 1);
    assert.notEqual(page.data[0].id, next.data[0].id);
    assert.equal(
      (await request(`transactions?limit=1&type=BUY&cursor=${page.page.nextCursor}`)).status,
      422,
    );
    const rejected = await request(
      "transactions",
      "POST",
      {
        accountId: account.id,
        type: "DIVIDEND",
        tradeDate: "2025-03-03",
        instrumentId,
        amount: { amount: "2", currency: "PLN" },
      },
      { "Idempotency-Key": randomUUID() },
    );
    assert.equal(rejected.status, 422);
    assert.equal((await request(`accounts/${account.id}`, "DELETE")).status, 403);
    assert.equal(
      (await request(`accounts/${account.id}`, "DELETE", undefined, { "x-step-up": "yes" })).status,
      204,
    );
    assert.equal((await request(`transactions/${first.id}`)).status, 404);
    assert.equal(events.length, responses.filter((r) => r.status === 201).length + 3);
  } finally {
    await auth.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth.users WHERE id=ANY(${sql.param([userId, otherId])}::uuid[])`,
      );
    });
    await database.close();
    await auth.close();
  }
}
