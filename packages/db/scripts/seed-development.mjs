import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/u);
const date = z.iso.date();
const currency = z.enum(["PLN", "USD", "EUR"]);
const instrumentSchema = z
  .object({
    key: z.string(),
    mic: z.string(),
    ticker: z.string(),
    name: z.string(),
    type: z.enum(["stock", "etf", "index"]),
    currency,
    country: z.string(),
    asset_class: z.literal("equity"),
    supports_fractional: z.boolean().optional(),
    exchange_short_name: z.string().optional(),
    sector_code: z.string().optional(),
    closes: z.array(decimal),
  })
  .strict();
const transactionSchema = z
  .object({
    account: z.string(),
    type: z.enum(["BUY", "DEPOSIT", "DIVIDEND"]),
    trade_date: date,
    settle_date: date,
    amount: decimal,
    cash_currency: currency,
    source: z.literal("demo"),
    sequence: decimal,
    instrument: z.string().optional(),
    quantity: decimal.optional(),
    price: decimal.optional(),
    price_currency: currency.optional(),
    fee: decimal.optional(),
    fee_currency: currency.optional(),
    tax: decimal.optional(),
    tax_currency: currency.optional(),
    fx_rate: decimal.nullable().optional(),
    fx_source: z.literal("broker").nullable().optional(),
  })
  .strict();
const schema = z
  .object({
    $schema: z.literal("docs/03-dane/schema.sql"),
    meta: z
      .object({
        version: z.literal("1"),
        generated: date,
        seed: decimal,
        baseDate: date,
        firstSession: date,
        sessions: decimal,
        note: z.string(),
      })
      .strict(),
    user: z
      .object({
        email: z.literal("dev@example.invalid"),
        name: z.string(),
        role: z.literal("admin"),
      })
      .strict(),
    accounts: z.array(
      z
        .object({
          key: z.string(),
          name: z.string(),
          broker: z.enum(["xtb", "mbank"]),
          account_type: z.literal("regular"),
          currency,
          external_ref: z.string(),
          opened_on: date,
        })
        .strict(),
    ),
    instruments: z.array(instrumentSchema),
    fxRates: z.array(
      z
        .object({
          base: currency,
          quote: z.literal("PLN"),
          source: z.literal("nbp"),
          from: date,
          rates: z.array(decimal),
        })
        .strict(),
    ),
    transactions: z.array(transactionSchema),
    expected: z
      .object({
        cash: z.object({ xtb: decimal, mbank: decimal, total: decimal }).strict(),
        positions: z.array(
          z
            .object({
              instrument: z.string(),
              quantity: decimal,
              cost_pln: decimal,
              value_pln: decimal,
              result_pln: decimal,
            })
            .strict(),
        ),
        portfolioValuePln: decimal,
        netDepositsPln: decimal,
      })
      .strict(),
  })
  .strict();

export async function readSeed() {
  const content = await readFile(
    new URL("../../../docs/03-dane/fixtures/seed-dev.json", import.meta.url),
    "utf8",
  );
  // Node 24 exposes the original numeric lexeme: money never passes through binary arithmetic.
  return schema.parse(
    JSON.parse(content, (_key, value, context) =>
      typeof value === "number" ? context.source : value,
    ),
  );
}

function sessions(seed) {
  const result = [];
  for (
    let day = new Date(`${seed.meta.firstSession}T00:00:00Z`);
    day.toISOString().slice(0, 10) <= seed.meta.baseDate;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (![0, 6].includes(day.getUTCDay())) result.push(day.toISOString().slice(0, 10));
  }
  assert.equal(result.length, Number(seed.meta.sessions));
  return result;
}

export async function seedDevelopment(client, mode, fixture) {
  if (mode !== "development" && mode !== "test")
    throw new Error("Seed requires explicit development/test mode");
  const seed = fixture ? schema.parse(fixture) : await readSeed();
  const days = sessions(seed);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(20260922)");
    // Idempotent only for this exact fixture. Never overwrite an existing portfolio.
    const existing = await client.query("SELECT id FROM auth.users WHERE email = $1", [
      seed.user.email,
    ]);
    if (existing.rowCount) {
      await assertSeed(client, seed, existing.rows[0].id);
      await client.query("COMMIT");
      return;
    }
    const userId = (
      await client.query(
        "INSERT INTO auth.users (email, name, role) VALUES ($1, $2, $3) RETURNING id",
        [seed.user.email, seed.user.name, seed.user.role],
      )
    ).rows[0].id;
    await client.query("SET LOCAL ROLE oliginvest_app");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const accounts = new Map();
    for (const a of seed.accounts) {
      const result = await client.query(
        "INSERT INTO portfolio.accounts (user_id, name, broker, account_type, currency, external_ref, opened_on) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [userId, a.name, a.broker, a.account_type, a.currency, a.external_ref, a.opened_on],
      );
      accounts.set(a.key, result.rows[0].id);
    }
    const instruments = new Map();
    for (const i of seed.instruments) {
      assert.equal(i.closes.length, days.length);
      const result = await client.query(
        "INSERT INTO market.instruments (mic,ticker,name,type,currency,country,asset_class,supports_fractional,exchange_short_name,sector_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [
          i.mic,
          i.ticker,
          i.name,
          i.type,
          i.currency,
          i.country,
          i.asset_class,
          i.supports_fractional ?? false,
          i.exchange_short_name,
          i.sector_code,
        ],
      );
      instruments.set(i.key, result.rows[0].id);
      await client.query(
        `INSERT INTO market.bars_daily (instrument_id,session_date,close,source)
        SELECT $1, d::date, c::numeric, 'demo' FROM unnest($2::text[], $3::text[]) AS rows(d,c)`,
        [result.rows[0].id, days, i.closes],
      );
    }
    for (const fx of seed.fxRates) {
      assert.equal(fx.from, seed.meta.firstSession);
      assert.equal(fx.rates.length, days.length);
      await client.query(
        `INSERT INTO market.fx_rates (base,quote,source,rate_date,rate)
        SELECT $1,$2,$3,d::date,r::numeric FROM unnest($4::text[],$5::text[]) AS rows(d,r)`,
        [fx.base, fx.quote, fx.source, days, fx.rates],
      );
    }
    for (const t of seed.transactions) {
      assert.ok(accounts.has(t.account));
      if (t.instrument) assert.ok(instruments.has(t.instrument));
      await client.query(
        `INSERT INTO portfolio.transactions
        (user_id,account_id,type,trade_date,settle_date,amount,cash_currency,source,sequence,instrument_id,quantity,price,price_currency,fee,fee_currency,tax,tax_currency,fx_rate,fx_source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          userId,
          accounts.get(t.account),
          t.type,
          t.trade_date,
          t.settle_date,
          t.amount,
          t.cash_currency,
          t.source,
          t.sequence,
          instruments.get(t.instrument),
          t.quantity,
          t.price,
          t.price_currency,
          t.fee ?? "0",
          t.fee_currency,
          t.tax ?? "0",
          t.tax_currency,
          t.fx_rate,
          t.fx_source,
        ],
      );
    }
    await assertSeed(client, seed, userId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function assertSeed(client, seed, userId) {
  await client.query("SET LOCAL ROLE oliginvest_app");
  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  const equal = async (actual, expected, label) => {
    assert.equal(
      (await client.query("SELECT $1::numeric = $2::numeric AS equal", [actual, expected])).rows[0]
        .equal,
      true,
      `Seed expected mismatch: ${label}`,
    );
  };
  const cash = (
    await client.query(
      `SELECT a.name, sum(t.amount)::text AS amount FROM portfolio.accounts a
    JOIN portfolio.transactions t ON t.account_id=a.id WHERE a.user_id=$1 GROUP BY a.name`,
      [userId],
    )
  ).rows;
  assert.equal(cash.length, seed.accounts.length);
  for (const account of seed.accounts)
    await equal(
      cash.find((row) => row.name === account.name)?.amount,
      seed.expected.cash[account.key],
      `cash.${account.key}`,
    );
  const totals = (
    await client.query(
      `SELECT count(*)::integer AS count, sum(amount)::text AS cash,
    sum(amount) FILTER (WHERE type='DEPOSIT')::text AS deposits FROM portfolio.transactions WHERE user_id=$1`,
      [userId],
    )
  ).rows[0];
  assert.equal(totals.count, seed.transactions.length);
  await equal(totals.cash, seed.expected.cash.total, "cash.total");
  await equal(totals.deposits, seed.expected.netDepositsPln, "netDepositsPln");
  // Fixture-only SQL oracle, not a runtime valuation implementation; all trades here are buys.
  const positions = (
    await client.query(
      `WITH holdings AS (
    SELECT instrument_id, sum(quantity) AS quantity, -sum(amount) AS cost
    FROM portfolio.transactions WHERE user_id=$1 AND type='BUY' GROUP BY instrument_id
  ) SELECT i.mic, i.ticker, h.quantity::text, h.cost::text,
    (h.quantity*b.close*CASE WHEN i.currency='PLN' THEN 1 ELSE f.rate END)::text AS value,
    round(h.quantity*b.close*CASE WHEN i.currency='PLN' THEN 1 ELSE f.rate END,2)::text AS rounded_value,
    round(h.quantity*b.close*CASE WHEN i.currency='PLN' THEN 1 ELSE f.rate END-h.cost,2)::text AS result
    FROM holdings h JOIN market.instruments i ON i.id=h.instrument_id
    JOIN market.bars_daily b ON b.instrument_id=i.id AND b.session_date=$2::date
    LEFT JOIN market.fx_rates f ON f.base=i.currency AND f.quote='PLN' AND f.rate_date=$2::date AND f.source='nbp'`,
      [userId, seed.meta.baseDate],
    )
  ).rows;
  assert.equal(positions.length, seed.expected.positions.length);
  for (const p of seed.expected.positions) {
    const instrument = seed.instruments.find((i) => i.key === p.instrument);
    const actual = positions.find(
      (row) => row.mic === instrument.mic && row.ticker === instrument.ticker,
    );
    assert.ok(actual);
    for (const [key, expected] of [
      ["quantity", p.quantity],
      ["cost", p.cost_pln],
      ["rounded_value", p.value_pln],
      ["result", p.result_pln],
    ])
      await equal(actual[key], expected, `${p.instrument}.${key}`);
  }
  const portfolio = (
    await client.query(
      "SELECT round($1::numeric + (SELECT sum(value::numeric) FROM unnest($2::text[]) AS x(value)),2)::text AS value",
      [totals.cash, positions.map((p) => p.value)],
    )
  ).rows[0].value;
  await equal(portfolio, seed.expected.portfolioValuePln, "portfolioValuePln");
}
