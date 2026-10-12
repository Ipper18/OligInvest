import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAppDatabase, createAuthDatabase } from "@oliginvest/db";
import { parseImport } from "@oliginvest/mod-portfolio/jobs";
import {
  ImportRepository,
  loadLedger,
  PortfolioRepository,
} from "@oliginvest/mod-portfolio/server";
import { sql } from "drizzle-orm";
import { createApp } from "../dist/app.js";

const fixture = (kind) =>
  readFileSync(
    new URL(
      `../../../modules/portfolio/test/fixtures/anonymized/mbank/mbank-syntetyczny-historia-${kind}.csv`,
      import.meta.url,
    ),
  );

export async function testMbankImportStorage(settings) {
  const connection = { host: settings.host, port: settings.port, database: settings.database };
  const database = createAppDatabase({ ...connection, password: settings.passwords.app }),
    auth = createAuthDatabase({ ...connection, password: settings.passwords.auth });
  const owner = { userId: randomUUID(), role: "user" },
    other = { userId: randomUUID(), role: "user" };
  const queued = [];
  let mbankEnabled = false;
  const portfolio = new PortfolioRepository(database, async (payload) => queued.push(payload));
  const imports = new ImportRepository(
    portfolio,
    async (payload) => queued.push(payload),
    async (_context, key) => key === "module.portfolio.import.mbank" && mbankEnabled,
  );
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
  const upload = async (accountId, bytes, source) => {
    const form = new FormData();
    form.set("accountId", accountId);
    if (source) form.set("source", source);
    form.set("file", new File([bytes], "synthetic.csv", { type: "text/csv" }));
    return request("imports", "POST", form);
  };
  const parsed = async (response) => {
    assert.equal(response.status, 202, await response.clone().text());
    const batch = await response.json();
    await parseImport(imports, { userId: owner.userId, importId: batch.id }, async () => {});
    return imports.get(owner, batch.id);
  };
  const rowsOf = async (id) => (await imports.list(owner, { limit: 200 }, id)).data;
  try {
    await auth.transaction(async (tx) => {
      for (const { userId } of [owner, other])
        await tx.execute(
          sql`INSERT INTO auth.users(id,name,email)VALUES(${userId}::uuid,'Synthetic mBank',${`${userId}@example.invalid`})`,
        );
    });
    // Two XWAR lines share the short name KGHM (only one has the ISIN) — the name is ambiguous.
    const kghm = randomUUID(),
      lookalike = randomUUID(),
      microsoft = randomUUID();
    await database.transaction({ userId: null, role: "system" }, async (tx) => {
      for (const [id, mic, isin, name, shortName, currency] of [
        [kghm, "XWAR", "PLKGHM000017", "KGHM Polska Miedź SA", "KGHM", "PLN"],
        [lookalike, "XWAR", null, "KGHM", null, "PLN"],
        [microsoft, "XNAS", null, "Microsoft Corporation", null, "USD"],
      ])
        await tx.execute(
          sql`INSERT INTO market.instruments(id,mic,ticker,isin,name,exchange_short_name,type,currency)VALUES(${id}::uuid,${mic},${`M${id.slice(0, 8)}`},${isin},${name},${shortName},'stock',${currency})`,
        );
    });
    const { value: account } = await portfolio.createAccount(owner, {
      name: "Synthetic mBank",
      broker: "mbank",
      accountType: "regular",
      currency: "PLN",
    });
    const disabled = await upload(account.id, fixture("finansowa"));
    assert.equal(disabled.status, 415, "mBank import stays behind its feature flag");
    mbankEnabled = true;

    // Financial history first: its T+2 settlements carry ISINs used as mapping hints.
    const financial = await parsed(await upload(account.id, fixture("finansowa")));
    assert.equal(financial.source, "mbank");
    assert.equal(financial.formatDetected, "mbank.financial");
    assert.deepEqual(financial.summary.byStatus, { new: 2, skipped: 2 });
    assert.equal(financial.reconciliation.cash[0].expected.amount, "3526.45");
    const dividendRow = (await rowsOf(financial.id)).find((r) => r.normalized?.quantity === "15");
    assert.equal(dividendRow.instrumentId, kghm, "dividend maps by ISIN");

    const trades = await parsed(await upload(account.id, fixture("transakcji"), "mbank"));
    assert.equal(trades.formatDetected, "mbank.transactions");
    assert.deepEqual(trades.summary.byStatus, { needs_mapping: 3, error: 1 });
    assert.deepEqual(trades.reconciliation.cash, [], "transaction history has no balance");
    assert.equal((await request(`imports/${trades.id}`, "GET", undefined, "b")).status, 404);
    assert.equal(
      (await request(`imports/${trades.id}/commit`, "POST", { acknowledgeDifferences: true }))
        .status,
      409,
    );
    const listed = await request(`imports/${trades.id}/rows?status=needs_mapping`);
    assert.equal(listed.status, 200);
    const pending = (await listed.json()).data;
    assert(pending.every((r) => r.statusReason === "ambiguous_instrument"));
    const first = pending.find((r) => r.rowNumber === 11);
    assert.deepEqual(
      first.candidates.map((c) => c.id),
      [kghm, lookalike],
      "settlement ISIN ranks first",
    );
    assert.equal(first.candidates[0].isin, "PLKGHM000017");
    const microsoftRow = (await rowsOf(trades.id)).find((r) => r.status === "error");
    assert.equal(microsoftRow.statusReason, "missing_settlement_value");
    assert.equal(microsoftRow.instrumentId, microsoft, "unique name within XNAS maps");
    assert.equal(
      (
        await request(
          `imports/${trades.id}/rows/${first.id}`,
          "PATCH",
          { action: "map_instrument", instrumentId: kghm },
          "b",
        )
      ).status,
      404,
    );
    const mapped = await request(`imports/${trades.id}/rows/${first.id}`, "PATCH", {
      action: "map_instrument",
      instrumentId: kghm,
    });
    assert.equal(mapped.status, 200, await mapped.clone().text());
    const afterMapping = await rowsOf(trades.id);
    assert.equal(afterMapping.filter((r) => r.status === "new").length, 3, "siblings resolved");
    const included = await request(`imports/${trades.id}/rows/${microsoftRow.id}`, "PATCH", {
      action: "include",
      fields: { fxRate: "4.02", fxSource: "manual" },
    });
    assert.equal(included.status, 200, await included.clone().text());
    assert.equal((await included.json()).normalized.amount.amount, "-3216");
    const ready = await imports.get(owner, trades.id);
    assert.equal(ready.reconciliation.ok, true, JSON.stringify(ready.reconciliation));
    const committed = await request(`imports/${trades.id}/commit`, "POST", {});
    assert.equal(committed.status, 200, await committed.clone().text());

    // The synthetic financial history is partial (one settlement), so cash differs until acknowledged.
    assert.equal((await request(`imports/${financial.id}/commit`, "POST", {})).status, 412);
    const acknowledged = await request(`imports/${financial.id}/commit`, "POST", {
      acknowledgeDifferences: true,
    });
    assert.equal(acknowledged.status, 200, await acknowledged.clone().text());
    const expected = JSON.parse(
      readFileSync(
        new URL(
          "../../../modules/portfolio/test/fixtures/anonymized/oczekiwane-wyniki.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).mbank;
    await portfolio.read(owner, async (tx) => {
      const { ledger } = await loadLedger(tx);
      const position = ledger.positions.find((p) => p.instrumentId === kghm);
      assert(position.quantity.eq(expected.positions_end[0].qty));
      assert(position.cost.amount.eq(expected.positions_end[0].cost_pln));
      const [want] = expected.realized_pl_economic;
      const sale = ledger.sales.find((s) => s.instrumentId === kghm);
      assert.equal(sale.tradeDate, want.date);
      assert(sale.proceedsEconomic.amount.eq(want.proceeds_pln));
      assert(sale.costEconomic.amount.eq(want.cost_pln));
      assert(sale.realizedPlEconomic.amount.eq(want.pl_pln));
      const dividend = ledger.dividends.find((d) => d.instrumentId === kghm);
      assert(dividend.credited.amount.eq(expected.dividends[0].net_pln));
      assert(dividend.gross.amount.eq(expected.dividends[0].gross_pln));
      assert(
        ledger.positions.find((p) => p.instrumentId === microsoft).quantity.eq("2"),
        "resolved US trade",
      );
      assert.equal(
        ledger.cash.find((c) => c.accountId === account.id).balance.amount.toFixed(),
        "1520.45",
      );
    });
    assert.equal((await upload(account.id, fixture("transakcji"))).status, 409);

    // A newer comma-separated UTF-8 export of the same trades is all duplicates; a new line is new
    // and picks up the remembered KGHM mapping.
    const modern = [
      "Czas transakcji,Papier,Giełda,K/S,Liczba,Kurs,Waluta,Prowizja,Waluta,Wartość,Waluta",
      '10.02.2025 09:01:12,KGHM,WWA-GPW,K,10,"150,50",PLN,"5,00",PLN,"1 505,00",PLN',
      '15.05.2025 11:22:05,KGHM,WWA-GPW,K,5,"140,00",PLN,"5,00",PLN,"700,00",PLN',
      '03.09.2025 14:45:30,KGHM,WWA-GPW,S,12,"160,00",PLN,"5,00",PLN,"1 920,00",PLN',
      '17.11.2025 16:10:00,MICROSOFT,USA-NASDAQ,K,2,"400,00",USD,,,,',
      '01.12.2025 10:00:00,KGHM,WWA-GPW,K,1,"170,00",PLN,"5,00",PLN,"170,00",PLN',
    ].join("\r\n");
    const reimport = await parsed(await upload(account.id, Buffer.from(modern)));
    assert.deepEqual(reimport.summary.byStatus, { duplicate: 4, new: 1 });
    const fresh = (await rowsOf(reimport.id)).find((r) => r.status === "new");
    assert.equal(fresh.instrumentId, kghm, "remembered name mapping");
    assert.equal((await request(`imports/${reimport.id}`, "DELETE")).status, 204);
    assert.equal(
      (await portfolio.listTransactions(owner, { limit: 200, sort: "tradeDate" })).data.length,
      6,
    );
    assert.equal(
      (await portfolio.listTransactions(other, { limit: 200, sort: "tradeDate" })).data.length,
      0,
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
