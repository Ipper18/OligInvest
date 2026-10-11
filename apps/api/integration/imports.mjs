import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { parseImport, recomputePortfolio } from "@oliginvest/mod-portfolio/jobs";
import {
  ImportRepository,
  livePortfolioValuation,
  loadLedger,
  PortfolioRepository,
} from "@oliginvest/mod-portfolio/server";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";

export async function testImportStorage(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAppDatabase({ ...connection, password: settings.passwords.app }),
    auth = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const owner = { userId: randomUUID(), role: "user" },
    other = { userId: randomUUID(), role: "admin" };
  const events = [],
    queued = [];
  const portfolio = new PortfolioRepository(database, async (payload) => queued.push(payload));
  const imports = new ImportRepository(portfolio, async (payload) => queued.push(payload));
  const app = createApp({
    checks: {},
    logger: { info() {}, warn() {}, error() {} },
    publicBaseUrl: "https://example.test",
    portfolio: {
      repository: () => portfolio,
      imports: () => imports,
      authorize: async (req) => (req.headers.get("x-owner") === "b" ? other : owner),
      assertOrigin() {},
    },
  });
  const request = (path, method = "GET", body, who = "a", key = randomUUID()) =>
    app.request(`/api/v1/portfolio/${path}`, {
      method,
      headers: {
        "x-owner": who,
        "Idempotency-Key": key,
        ...(body instanceof FormData ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  const fixture = (kind) =>
    readFileSync(
      new URL(
        `../../../modules/portfolio/test/fixtures/anonymized/xtb/xtb-syntetyczny-${kind}-szablon-PLN.xlsx`,
        import.meta.url,
      ),
    );
  const upload = async (accountId, bytes, who = "a") => {
    const form = new FormData();
    form.set("accountId", accountId);
    form.set("file", new File([bytes], "synthetic.xlsx"));
    return request("imports", "POST", form, who);
  };
  try {
    await auth.transaction(async (tx) => {
      for (const { userId } of [owner, other])
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email)VALUES(${userId}::uuid,'Synthetic import',${`${userId}@example.invalid`})`,
        );
    });
    const symbols = {};
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      for (const [symbol, currency, mic] of [
        ["AAPL.US", "USD", "XNAS"],
        ["PKO.PL", "PLN", "XWAR"],
        ["VWCE.DE", "EUR", "XETR"],
      ]) {
        const [existing] = (
          await tx.execute(
            sql`SELECT instrument_id::text AS id FROM market.instrument_provider_symbols WHERE provider='xtb' AND symbol=${symbol}`,
          )
        ).rows;
        const id = existing?.id ?? randomUUID();
        symbols[symbol] = id;
        if (!existing) {
          await tx.execute(
            sql`INSERT INTO market.instruments(id,mic,ticker,name,type,currency)VALUES(${id}::uuid,${mic},${`S${id.slice(0, 8)}`},'Synthetic import','stock',${currency})`,
          );
          await tx.execute(
            sql`INSERT INTO market.instrument_provider_symbols(provider,symbol,instrument_id)VALUES('xtb',${symbol},${id}::uuid)`,
          );
        }
      }
    });
    const { value: account } = await portfolio.createAccount(owner, {
      name: "Synthetic import",
      broker: "xtb",
      accountType: "regular",
      currency: "PLN",
    });
    assert.equal((await upload(account.id, fixture("nowy"), "b")).status, 404);
    assert.equal((await upload(account.id, Buffer.alloc(10485761))).status, 413);
    const response = await upload(account.id, fixture("nowy"));
    assert.equal(response.status, 202);
    const batch = await response.json();
    assert.equal((await upload(account.id, fixture("nowy"))).status, 409);
    assert.equal((await request(`imports/${batch.id}`, "GET", undefined, "b")).status, 404);
    assert.equal((await request(`imports/${batch.id}/rows`, "GET", undefined, "b")).status, 404);
    await parseImport(imports, { userId: owner.userId, importId: batch.id }, async (u, event) => {
      assert.equal(u, owner.userId);
      assert.equal((await imports.get(owner, batch.id)).status, "parsed");
      events.push(event);
    });
    const preview = await imports.get(owner, batch.id);
    assert.equal(preview.status, "parsed");
    assert.equal(preview.summary.rowsTotal, 17);
    assert.equal(
      (await request(`imports/${batch.id}/commit`, "POST", { acknowledgeDifferences: true }))
        .status,
      409,
    );
    const all = await imports.list(owner, { limit: 200 }, batch.id);
    const dividend = all.data.find((r) => r.raw.id === "900006");
    assert.equal(dividend.status, "error");
    assert.equal(
      (
        await request(
          `imports/${batch.id}/rows/${dividend.id}`,
          "PATCH",
          { action: "include", fields: { quantity: "15" } },
          "b",
        )
      ).status,
      404,
    );
    const resolved = await request(`imports/${batch.id}/rows/${dividend.id}`, "PATCH", {
      action: "include",
      fields: { quantity: "15" },
    });
    assert.equal(resolved.status, 200, await resolved.clone().text());
    const reconciled = await imports.get(owner, batch.id);
    assert.equal(reconciled.reconciliation.ok, true, JSON.stringify(reconciled.reconciliation));
    assert.equal(reconciled.reconciliation.cash[0].computed.amount, "14518.27");
    const key = randomUUID();
    const committed = await request(`imports/${batch.id}/commit`, "POST", {}, "a", key);
    assert.equal(committed.status, 200, await committed.clone().text());
    const replay = await request(`imports/${batch.id}/commit`, "POST", {}, "a", key);
    assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
    await portfolio.read(owner, async (tx) => {
      const { ledger } = await loadLedger(tx);
      const expected = JSON.parse(
        readFileSync(
          new URL(
            "../../../modules/portfolio/test/fixtures/anonymized/oczekiwane-wyniki.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ).xtb;
      for (const p of expected.positions_end) {
        const position = ledger.positions.find((row) => row.instrumentId === symbols[p.ticker]);
        assert(position.quantity.eq(p.qty));
        assert(position.cost.amount.eq(p.cost_pln));
      }
      for (const s of expected.realized_pl_economic) {
        const sale = ledger.sales.find(
          (row) => row.instrumentId === symbols[s.ticker] && row.tradeDate === s.date,
        );
        assert(sale.realizedPlEconomic.amount.eq(s.pl_pln));
        assert(sale.costEconomic.amount.eq(s.cost_pln));
        assert(sale.proceedsEconomic.amount.eq(s.proceeds_pln));
      }
      for (const d of expected.dividends) {
        const dividend = ledger.dividends.find((row) => row.instrumentId === symbols[d.ticker]);
        assert(dividend.credited.amount.eq(d.net_pln));
        assert(
          dividend.gross.amount
            .mul(dividend.credited.amount)
            .div(dividend.net.amount)
            .toDecimalPlaces(2)
            .eq(d.gross_pln),
        );
      }
      assert.equal(
        ledger.cash.find((r) => r.balance.currency === "PLN").balance.amount.toFixed(),
        "14518.27",
      );
      const sale = ledger.sales.find((s) => s.instrumentId === symbols["AAPL.US"]);
      assert.equal(sale.realizedPlEconomic.amount.toFixed(), "-1083.91");
      assert.equal(
        ledger.positions.find((p) => p.instrumentId === symbols["AAPL.US"]).quantity.toFixed(),
        "3",
      );
    });
    const legacy = await (await upload(account.id, fixture("stary"))).json();
    await parseImport(imports, { userId: owner.userId, importId: legacy.id }, async () => {});
    const duplicate = await imports.get(owner, legacy.id);
    assert.equal(duplicate.summary.byStatus.duplicate, 17);
    const reimport = await request(`imports/${legacy.id}/commit`, "POST", {});
    assert.equal(reimport.status, 200, await reimport.clone().text());
    const ownerRows = await portfolio.listTransactions(owner, { limit: 200, sort: "tradeDate" });
    assert.equal(ownerRows.data.length, 14);
    assert.equal(
      (await portfolio.listTransactions(other, { limit: 200, sort: "tradeDate" })).data.length,
      0,
    );
    assert.equal((await request(`imports/${batch.id}`, "DELETE")).status, 409);
    assert.equal(events[0].event, "portfolio.import.parsed");
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      for (const [base, rate] of [
        ["USD", "4"],
        ["EUR", "4.5"],
      ])
        await tx.execute(
          sql`INSERT INTO market.fx_rates(base,quote,rate_date,rate,source) VALUES(${base},'PLN','2025-12-29',${rate},'nbp') ON CONFLICT(base,quote,rate_date,source) DO UPDATE SET rate=excluded.rate`,
        );
      for (const [symbol, price] of [
        ["AAPL.US", "250"],
        ["PKO.PL", "73"],
        ["VWCE.DE", "125"],
      ])
        await tx.execute(
          sql`INSERT INTO market.bars_daily(instrument_id,session_date,close,source) VALUES(${symbols[symbol]}::uuid,'2025-12-31',${price},'synthetic') ON CONFLICT(instrument_id,session_date) DO UPDATE SET close=excluded.close`,
        );
      // Yesterday's close is the same, so today's quote movement has a known cash-neutral delta.
      await tx.execute(
        sql`INSERT INTO market.bars_daily(instrument_id,session_date,close,source) SELECT instrument_id,'2025-12-29',close,source FROM market.bars_daily WHERE session_date='2025-12-31' AND instrument_id=ANY(${sql.param(Object.values(symbols))}::uuid[]) ON CONFLICT DO NOTHING`,
      );
    });
    const start = performance.now();
    const payload = {
      userId: owner.userId,
      accountIds: [account.id],
      fromDate: "2025-01-01",
      reason: "import",
    };
    const now = () => new Date("2025-12-31T20:00:00Z");
    const publish = async (userId, event) => {
      assert.equal(userId, owner.userId);
      await database.transaction(owner, async (tx) => {
        const [count] = (
          await tx.execute(
            sql`SELECT count(*)::integer AS count FROM portfolio.positions_daily WHERE valuation_date='2025-12-31'`,
          )
        ).rows;
        assert.equal(count.count, 3);
      });
      events.push(event);
    };
    await recomputePortfolio(portfolio, payload, publish, now);
    assert(performance.now() - start < 5000, "recompute must finish within five seconds");
    const snapshot = () =>
      database.transaction(owner, async (tx) => ({
        positions: (
          await tx.execute(
            sql`SELECT account_id,instrument_id,quantity,cost_basis,market_value FROM portfolio.positions_daily WHERE valuation_date='2025-12-31' ORDER BY instrument_id`,
          )
        ).rows,
        cash: (
          await tx.execute(
            sql`SELECT balance FROM portfolio.cash_balances_daily WHERE valuation_date='2025-12-31'`,
          )
        ).rows,
        pl: (
          await tx.execute(
            sql`SELECT sum(realized_pl_economic)::text AS value FROM portfolio.lot_consumptions`,
          )
        ).rows,
      }));
    const before = await snapshot();
    assert.equal(before.cash[0].balance, "14518.27000000");
    assert.equal(before.pl[0].value, "-902.71000000");
    assert.equal(
      before.positions.find((p) => p.instrument_id === symbols["AAPL.US"]).market_value,
      "3000.00000000",
    );
    await recomputePortfolio(portfolio, payload, async () => {}, now);
    assert.deepEqual(await snapshot(), before);
    await database.transaction(other, async (tx) => {
      assert.equal((await tx.execute(sql`SELECT * FROM portfolio.positions_daily`)).rows.length, 0);
    });
    await portfolio.createTransaction(
      owner,
      {
        accountId: account.id,
        type: "SECURITY_TRANSFER_IN",
        tradeDate: "2025-12-30",
        instrumentId: symbols["AAPL.US"],
        quantity: "1",
      },
      randomUUID(),
    );
    await recomputePortfolio(
      portfolio,
      { ...payload, fromDate: "2025-12-30", reason: "transactions" },
      async () => {},
      now,
    );
    const unknown = (await snapshot()).positions.find(
      (p) => p.instrument_id === symbols["AAPL.US"],
    );
    assert.equal(unknown.cost_basis, null);
    assert.equal(unknown.quantity, "4.0000000000");
    assert.equal(unknown.market_value, "4000.00000000");
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO market.quotes_latest(instrument_id,price,as_of,source) VALUES(${symbols["AAPL.US"]}::uuid,'260','2025-12-31T19:00:00Z','synthetic') ON CONFLICT(instrument_id) DO UPDATE SET price=excluded.price,as_of=excluded.as_of,source=excluded.source`,
      );
    });
    const live = await livePortfolioValuation(portfolio, owner, now);
    assert.equal(live.summary.dayChange.amount, "160");
    assert.equal(live.reason, "quotes");
    assert.deepEqual(live.accountIds, [account.id]);
    assert.deepEqual((await livePortfolioValuation(portfolio, other, now)).accountIds, []);
    assert.deepEqual(
      (await snapshot()).positions.find((p) => p.instrument_id === symbols["AAPL.US"]),
      unknown,
      "live valuation must not rewrite EOD history",
    );
  } finally {
    await auth.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM auth.users WHERE id=ANY(${sql.param([owner.userId, other.userId])}::uuid[])`,
      );
    });
    await database.close();
    await auth.close();
  }
}
