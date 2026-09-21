import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAnalyticsDatabase, createAppDatabase, createAuthDatabase } from "../src/index.ts";
import { runTransaction } from "../src/transaction.ts";

const a = randomUUID();
const b = randomUUID();
const contextA = { userId: a, role: "pro" };
const contextB = { userId: b, role: "user" };
let app, auth, analytics, rawPool, wrongPool;
const inspect = sql`SELECT current_user AS db_role, pg_backend_pid() AS pid,
  platform.current_user_id() AS user_id, platform.current_app_role() AS role,
  (SELECT count(*)::int FROM portfolio.accounts) AS accounts`;

beforeAll(async () => {
  const { passwords, ...base } = JSON.parse(process.env.OLIGINVEST_TEST_DATABASE);
  app = createAppDatabase({ ...base, password: passwords.app, max: 2 });
  auth = createAuthDatabase({ ...base, password: passwords.auth, max: 1 });
  analytics = createAnalyticsDatabase({ ...base, password: passwords.analytics, max: 1 });
  rawPool = new pg.Pool({ ...base, password: passwords.app, user: "oliginvest_app", max: 1 });
  wrongPool = new pg.Pool({ ...base, password: passwords.auth, user: "oliginvest_auth", max: 1 });
  rawPool.on("error", () => {});
  await auth.transaction(async (tx) => {
    for (const [id, email] of [
      [a, "pool-a@example.test"],
      [b, "pool-b@example.test"],
    ]) {
      await tx.execute(
        sql`INSERT INTO auth.users (id, name, email) VALUES (${id}, 'Pool fixture', ${email})`,
      );
    }
  });
  for (const context of [contextA, contextB]) {
    await app.transaction(context, (tx) =>
      tx.execute(sql`INSERT INTO portfolio.accounts
      (user_id, name, broker, currency) VALUES (${context.userId}, 'pool fixture', 'demo', 'PLN')`),
    );
  }
});

afterAll(async () => {
  await Promise.all([
    app?.close(),
    auth?.close(),
    analytics?.close(),
    rawPool?.end(),
    wrongPool?.end(),
  ]);
});

test("concurrent users keep their identity and RLS on different pool connections", async () => {
  let ready = 0;
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  const rows = await Promise.all(
    [contextA, contextB].map((context) =>
      app.transaction(context, async (tx) => {
        ready++;
        if (ready === 2) open();
        await gate;
        const row = (await tx.execute(inspect)).rows[0];
        expect(row).toMatchObject({
          user_id: context.userId,
          role: context.role,
          accounts: 1,
          db_role: "oliginvest_app",
        });
        return row;
      }),
    ),
  );
  expect(rows[0].pid).not.toBe(rows[1].pid);
});

test("both settings are cleared on the very same connection after commit and rollback", async () => {
  const initialPid = (await rawPool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  for (const failure of ["none", "callback", "sql", "swallowed-sql"]) {
    const operation = runTransaction(rawPool, "oliginvest_app", contextA, async (tx) => {
      expect((await tx.execute(inspect)).rows[0]).toMatchObject({
        pid: initialPid,
        user_id: a,
        role: "pro",
      });
      if (failure === "callback") {
        await tx.execute(sql`INSERT INTO portfolio.accounts (user_id, name, broker, currency)
          VALUES (${a}, 'must roll back', 'demo', 'PLN')`);
        throw new Error("rollback fixture");
      }
      if (failure === "sql") await tx.execute(sql`SELECT 1/0`);
      if (failure === "swallowed-sql") {
        try {
          await tx.execute(sql`SELECT 1/0`);
        } catch {
          /* Deliberately swallowed. */
        }
      }
    });
    if (failure === "none") await operation;
    else await expect(operation).rejects.toThrow();
    const outside = (
      await rawPool.query(`SELECT pg_backend_pid() AS pid,
      platform.current_user_id() AS user_id, platform.current_app_role() AS role,
      (SELECT count(*)::int FROM portfolio.accounts) AS accounts`)
    ).rows[0];
    expect(outside).toEqual({ pid: initialPid, user_id: null, role: "anonymous", accounts: 0 });
    await runTransaction(rawPool, "oliginvest_app", contextB, async (tx) => {
      expect((await tx.execute(inspect)).rows[0]).toMatchObject({
        pid: initialPid,
        user_id: b,
        role: "user",
        accounts: 1,
      });
    });
  }
  await app.transaction(contextA, async (tx) => {
    expect((await tx.execute(inspect)).rows[0].accounts).toBe(1);
  });
});

test("session settings written by callback are scrubbed before release", async () => {
  await runTransaction(rawPool, "oliginvest_app", contextA, (tx) =>
    tx.execute(
      sql`SELECT set_config('app.user_id', ${a}, false), set_config('app.role', 'admin', false)`,
    ),
  );
  const row = (
    await rawPool.query(
      "SELECT platform.current_user_id() AS user_id, platform.current_app_role() AS role",
    )
  ).rows[0];
  expect(row).toEqual({ user_id: null, role: "anonymous" });
});

test("nested rollback uses a savepoint and retains the outer identity", async () => {
  await app.transaction(contextA, async (tx) => {
    await expect(tx.transaction((nested) => nested.execute(sql`SELECT 1/0`))).rejects.toThrow();
    expect((await tx.execute(inspect)).rows[0]).toMatchObject({
      user_id: a,
      role: "pro",
      accounts: 1,
    });
  });
});

test("anonymous and system without a user cannot inherit another user's portfolio", async () => {
  for (const role of ["anonymous", "system"]) {
    await app.transaction({ role, userId: null }, async (tx) => {
      expect((await tx.execute(inspect)).rows[0]).toMatchObject({
        user_id: null,
        role,
        accounts: 0,
      });
    });
  }
});

test("app/auth/analytics use separate database identities and enforce their privileges", async () => {
  const describe = sql`SELECT current_user AS role, pg_backend_pid() AS pid, current_setting('transaction_read_only') AS read_only`;
  const rows = await Promise.all([
    app.transaction(contextA, (tx) => tx.execute(describe)),
    auth.transaction((tx) => tx.execute(describe)),
    analytics.transaction((tx) => tx.execute(describe)),
  ]);
  expect(rows.map((r) => r.rows[0].role)).toEqual([
    "oliginvest_app",
    "oliginvest_auth",
    "oliginvest_analytics_ro",
  ]);
  expect(new Set(rows.map((r) => r.rows[0].pid)).size).toBe(3);
  expect(rows[2].rows[0].read_only).toBe("on");
  await expect(
    app.transaction(contextA, (tx) => tx.execute(sql`SELECT * FROM auth.accounts`)),
  ).rejects.toThrow();
  await expect(
    auth.transaction((tx) => tx.execute(sql`SELECT * FROM portfolio.accounts`)),
  ).rejects.toThrow();
  await expect(
    analytics.transaction((tx) => tx.execute(sql`SELECT * FROM market.watchlists`)),
  ).rejects.toThrow();
  await expect(
    analytics.transaction((tx) => tx.execute(sql`DELETE FROM market.bars_daily`)),
  ).rejects.toThrow();
  await expect(
    analytics.transaction((tx) => tx.execute(sql`SELECT * FROM market.bars_daily`)),
  ).resolves.toBeDefined();
});

test("wrong database identity is rejected before invoking application code", async () => {
  let called = false;
  await expect(
    runTransaction(wrongPool, "oliginvest_app", contextA, async () => {
      called = true;
    }),
  ).rejects.toThrow("Database role");
  expect(called).toBe(false);
});

test("a broken connection is discarded and the next transaction gets a clean one", async () => {
  const before = (await rawPool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await expect(
    runTransaction(rawPool, "oliginvest_app", contextA, (tx) =>
      tx.execute(sql`SELECT pg_terminate_backend(pg_backend_pid())`),
    ),
  ).rejects.toThrow();
  await runTransaction(rawPool, "oliginvest_app", contextB, async (tx) => {
    const row = (await tx.execute(inspect)).rows[0];
    expect(row.pid).not.toBe(before);
    expect(row).toMatchObject({ user_id: b, role: "user", accounts: 1 });
  });
});

test("context rejects malformed identities, unknown fields and roles", async () => {
  for (const context of [
    { role: "admin", userId: null },
    { role: "root", userId: a },
    { role: "user", userId: "bad" },
    { ...contextA, extra: "secret" },
  ]) {
    await expect(app.transaction(context, async () => {})).rejects.toThrow(
      "Invalid database context",
    );
  }
});
