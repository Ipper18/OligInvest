import { createHash } from "node:crypto";
import {
  addDays,
  aggregateMarketBars,
  inspectMarketBar,
  settlementCycleDays,
  settlementDate,
  settlementRegionForMic,
} from "@oliginvest/core";
import { type Bar, barSchema, type Quote, quoteSchema } from "@oliginvest/data-providers";
import type { AppDatabase, DatabaseContext, DatabaseTransaction } from "@oliginvest/db";
import { ProblemError } from "@oliginvest/platform";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  apiQuoteSchema,
  chartSchema,
  fxResponseSchema,
  instrumentSchema,
  pageSchema,
  statusSchema,
  summarySchema,
} from "../contracts.js";

const system = { userId: null, role: "system" } as const;
const columns = sql`id::text,coalesce(ticker,isin,id::text) AS ticker,name,isin,mic,currency,type,country,is_active AS "isActive",exchange_short_name AS "exchangeShortName"`;
const clean = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
const dateText = z.string().date();
export class MarketRepository {
  constructor(
    readonly database: AppDatabase,
    private readonly now = () => new Date(),
  ) {}
  async search(
    context: DatabaseContext,
    query: {
      q: string;
      type?: string[] | undefined;
      mic?: string | undefined;
      includeInactive: boolean;
      limit: number;
      cursor?: string | undefined;
    },
  ) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([query.q, query.type, query.mic, query.includeInactive]))
      .digest("hex");
    let cursor: { rank: number; id: string } | undefined;
    if (query.cursor) {
      try {
        const parsed = z
          .object({
            rank: z.number().int().min(0).max(1),
            id: z.uuid(),
            fingerprint: z.literal(fingerprint),
          })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
        cursor = parsed;
      } catch {
        throw new ProblemError("VALIDATION_FAILED");
      }
    }
    const pattern = `%${query.q.replace(/[\\%_]/gu, "\\$&")}%`;
    const rank = sql`CASE WHEN upper(ticker)=upper(${query.q}) OR isin=${query.q} THEN 0 ELSE 1 END`;
    const rows = await this.database.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(sql`
      SELECT ${columns},${rank} AS rank FROM market.instruments
      WHERE (${query.includeInactive} OR is_active)
      AND (${query.mic ?? null}::text IS NULL OR mic=${query.mic ?? null})
      AND (${sql.param(query.type?.length ? query.type : null)}::text[] IS NULL OR type=ANY(${sql.param(query.type ?? [])}::text[]))
      AND (ticker ILIKE ${pattern} OR name ILIKE ${pattern} OR isin ILIKE ${pattern}
        OR id IN (SELECT instrument_id FROM market.instrument_provider_symbols WHERE symbol ILIKE ${pattern}))
      AND (${cursor?.id ?? null}::uuid IS NULL OR (${rank},id)>(${cursor?.rank ?? 0},${cursor?.id ?? null}::uuid))
      ORDER BY rank,id LIMIT ${query.limit + 1}`)
        ).rows,
    );
    const hasMore = rows.length > query.limit;
    const chosen = rows.slice(0, query.limit);
    const last = chosen.at(-1);
    return pageSchema.parse({
      data: chosen.map(({ rank: _rank, ...row }) => summarySchema.parse(clean(row))),
      page: {
        hasMore,
        ...(hasMore && last
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({ rank: last.rank, id: last.id, fingerprint }),
              ).toString("base64url"),
            }
          : {}),
      },
    });
  }
  async quotes(context: DatabaseContext, ids: string[]): Promise<Quote[]> {
    return this.database.transaction(context, async (tx) => {
      const rows = (
        await tx.execute(sql`SELECT i.id::text AS "instrumentId",i.currency,
        coalesce(q.price,b.close)::text AS price,q.prev_close::text AS "prevClose",q.change::text AS change,q.change_pct AS "changeRatio",coalesce(q.volume,b.volume)::text AS volume,
        to_char(coalesce(q.as_of,b.session_date::timestamp AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "asOf",
        coalesce(q.delay_minutes,0) AS delay,coalesce(q.source,b.source) AS source,
        to_char(coalesce(q.fetched_at,b.ingested_at),'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "fetchedAt",
        b.session_date::text AS "sessionDate", q.instrument_id IS NULL AS eod,
        EXISTS(SELECT 1 FROM market.data_quality_issues d WHERE d.instrument_id=i.id AND d.status='open' AND d.severity='BLOCK') AS hold
        FROM market.instruments i
        LEFT JOIN LATERAL (SELECT * FROM market.bars_daily WHERE instrument_id=i.id ORDER BY session_date DESC LIMIT 1) b ON true
        LEFT JOIN market.quotes_latest q ON q.instrument_id=i.id
          AND (b.session_date IS NULL
            OR (q.as_of AT TIME ZONE CASE WHEN i.mic='XWAR' THEN 'Europe/Warsaw' ELSE 'America/New_York' END)::date>b.session_date
            OR ((q.as_of AT TIME ZONE CASE WHEN i.mic='XWAR' THEN 'Europe/Warsaw' ELSE 'America/New_York' END)::date=b.session_date AND q.fetched_at>b.ingested_at))
        WHERE i.id=ANY(${sql.param(ids)}::uuid[]) AND coalesce(q.price,b.close) IS NOT NULL`)
      ).rows;
      return rows.map(({ asOf, delay, source, eod, hold, ...row }) => {
        const age = this.now().getTime() - Date.parse(String(row.fetchedAt));
        const stale = Boolean(hold) || Boolean(eod) || age > 300_000;
        return quoteSchema.parse({
          ...clean(row),
          meta: {
            source,
            asOf,
            delayMinutes: delay,
            stale,
            ...(stale
              ? { staleReason: hold ? "data_quality_hold" : eod ? "eod_only" : "provider_error" }
              : {}),
            attribution: source === "yahoo" ? "Dane: Yahoo Finance" : "Źródło: GPW",
          },
        });
      });
    });
  }
  async instrument(context: DatabaseContext, id: string) {
    const row = await this.database.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT ${columns},lot_size::text AS "lotSize", supports_fractional AS "supportsFractional",delisted_on::text AS "delistedOn" FROM market.instruments WHERE id=${id}::uuid`,
          )
        ).rows[0],
    );
    if (!row) throw new ProblemError("NOT_FOUND");
    const quote = (await this.quotes(context, [id]))[0];
    const [range, sources] = await this.database.transaction(context, async (tx) =>
      Promise.all([
        tx.execute(
          sql`SELECT min(low)::text AS low,max(high)::text AS high FROM market.bars_daily WHERE instrument_id=${id}::uuid AND NOT no_trades AND session_date>=${addDays(this.today(), -365)}::date`,
        ),
        tx.execute(
          sql`SELECT source FROM market.bars_daily WHERE instrument_id=${id}::uuid ORDER BY session_date DESC LIMIT 1`,
        ),
      ]),
    );
    return instrumentSchema.parse({
      ...clean(row),
      dataSources: {
        eod: sources.rows[0]?.source ?? null,
        intraday: quote?.meta.source === "yahoo" ? "yahoo" : null,
      },
      ...(quote
        ? {
            quote: apiQuoteSchema.parse(
              Object.fromEntries(Object.entries(quote).filter(([key]) => key !== "fetchedAt")),
            ),
          }
        : {}),
      ...(range.rows[0]?.low !== null && range.rows[0]?.high !== null
        ? { range52w: range.rows[0] }
        : {}),
    });
  }
  today(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(this.now());
  }
  async chart(
    context: DatabaseContext,
    id: string,
    options: {
      from?: string | undefined;
      to?: string | undefined;
      interval: "15m" | "1h" | "1d" | "1w" | "1mo";
      maxPoints: number;
      adjusted: boolean;
    },
  ) {
    const to = options.to ?? this.today();
    const from = options.from ?? addDays(to, -3653);
    if (from > to) throw new ProblemError("VALIDATION_FAILED");
    const result = await this.database.transaction(context, async (tx) => {
      const instrument = (
        await tx.execute(
          sql`SELECT currency,EXISTS(SELECT 1 FROM market.data_quality_issues WHERE instrument_id=${id}::uuid AND severity='BLOCK' AND status='open') AS hold FROM market.instruments WHERE id=${id}::uuid`,
        )
      ).rows[0];
      if (!instrument) throw new ProblemError("NOT_FOUND");
      if (options.interval === "15m" || options.interval === "1h")
        return {
          currency: instrument.currency,
          hold: Boolean(instrument.hold),
          rows: [],
          actions: [],
        };
      const rows = (
        await tx.execute(
          sql`SELECT session_date::text AS date,open::text,high::text,low::text,close::text,volume::text,adjustment_factor::text AS "adjustmentFactor",source FROM market.bars_daily WHERE instrument_id=${id}::uuid AND NOT no_trades AND session_date BETWEEN ${from}::date AND ${to}::date ORDER BY session_date`,
        )
      ).rows;
      const actions = (
        await tx.execute(
          sql`SELECT ex_date::text AS date,type,ratio_from AS "ratioFrom",ratio_to AS "ratioTo" FROM market.corporate_actions WHERE instrument_id=${id}::uuid AND type IN ('split','reverse_split','dividend') AND ex_date BETWEEN ${from}::date AND ${to}::date ORDER BY ex_date`,
        )
      ).rows.map(clean);
      return { currency: instrument.currency, hold: Boolean(instrument.hold), rows, actions };
    });
    const full = result.rows.map(({ source: _s, ...row }) =>
      z
        .object({
          date: dateText,
          open: z.string().nullable(),
          high: z.string().nullable(),
          low: z.string().nullable(),
          close: z.string(),
          volume: z.string(),
          adjustmentFactor: z.string(),
        })
        .strict()
        .parse(row),
    );
    const bars = aggregateMarketBars(
      full,
      options.interval === "1w" || options.interval === "1mo" ? options.interval : "1d",
      options.maxPoints,
      options.adjusted,
    );
    const last = result.rows.at(-1);
    return chartSchema.parse({
      instrumentId: id,
      interval: options.interval,
      adjusted: options.adjusted,
      currency: result.currency,
      t: bars.map((bar) => Date.parse(`${bar.date}T00:00:00Z`) / 1000),
      o: bars.map((bar) => bar.open),
      h: bars.map((bar) => bar.high),
      l: bars.map((bar) => bar.low),
      c: bars.map((bar) => bar.close),
      v: bars.map((bar) => bar.volume),
      decimated: bars.length < full.length,
      corporateActions: result.actions,
      meta: {
        source: last?.source ?? "computed",
        asOf: last ? `${last.date}T00:00:00Z` : this.now().toISOString(),
        delayMinutes: 0,
        stale: result.hold || !last,
        ...(result.hold || !last
          ? { staleReason: result.hold ? "data_quality_hold" : "no_data" }
          : {}),
        attribution: last?.source === "yahoo" ? "Dane: Yahoo Finance" : "Źródło: GPW",
      },
    });
  }
  async fx(context: DatabaseContext, currencies: string[], from?: string, to?: string) {
    const end = to ?? this.today();
    const start = from ?? addDays(end, -7);
    if (start > end) throw new ProblemError("VALIDATION_FAILED");
    const rows = await this.database.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT DISTINCT ON (base,rate_date) base,rate_date::text AS date,rate::text,table_no AS "tableNo",source FROM market.fx_rates WHERE quote='PLN' AND base=ANY(${sql.param(currencies)}::text[]) AND rate_date BETWEEN ${start}::date AND ${end}::date ORDER BY base,rate_date,CASE source WHEN 'nbp' THEN 0 ELSE 1 END`,
          )
        ).rows,
    );
    const lastDate = rows
      .map((row) => String(row.date))
      .sort()
      .at(-1);
    const fallback = rows.some((row) => row.source === "ecb");
    return fxResponseSchema.parse({
      quote: "PLN",
      series: currencies.map((currency) => ({
        currency,
        items: rows
          .filter((row) => row.base === currency)
          .map(({ base: _b, source: _s, ...row }) => clean(row)),
      })),
      meta: {
        source: fallback ? "ecb" : "nbp",
        asOf: lastDate ? `${lastDate}T00:00:00Z` : this.now().toISOString(),
        delayMinutes: 0,
        stale: fallback || !lastDate,
        ...(fallback || !lastDate ? { staleReason: fallback ? "provider_error" : "no_data" } : {}),
        attribution: fallback ? "Kursy: EBC (Frankfurter)" : "Kursy: NBP",
      },
    });
  }
  async status(context: DatabaseContext) {
    const rows = await this.database.transaction(
      context,
      async (tx) =>
        (
          await tx.execute(sql`SELECT 'gpw_eod' AS key,max(ingested_at) AS last FROM market.bars_daily WHERE source='gpw'
      UNION ALL SELECT 'fx',max(fetched_at) FROM market.fx_rates
      UNION ALL SELECT CASE WHEN i.mic='XWAR' THEN 'intraday_gpw' ELSE 'intraday_us' END,max(q.fetched_at) FROM market.quotes_latest q JOIN market.instruments i ON i.id=q.instrument_id GROUP BY 1`)
        ).rows,
    );
    const categories = [
      "gpw_eod",
      "intraday_gpw",
      "intraday_us",
      "fx",
      "news",
      "macro",
      "fundamentals",
    ].map((key) => {
      const last = rows.find((row) => row.key === key)?.last;
      if (["news", "macro", "fundamentals"].includes(key))
        return { key, status: "disabled", staleReason: "provider_disabled" };
      if (!last) return { key, status: "down", staleReason: "no_data" };
      const stamp = z.coerce.date().parse(last);
      const stale =
        this.now().getTime() - stamp.getTime() >
        (key.startsWith("intraday") ? 300_000 : 3 * 86_400_000);
      return {
        key,
        status: stale ? "degraded" : "ok",
        lastSuccessAt: stamp.toISOString(),
        ...(stale ? { staleReason: "provider_error" } : {}),
      };
    });
    return statusSchema.parse({ asOf: this.now().toISOString(), categories });
  }
  async resolve(id: string) {
    const row = await this.database.transaction(
      system,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT i.id::text,i.currency,i.mic,s.symbol FROM market.instruments i JOIN market.instrument_provider_symbols s ON s.instrument_id=i.id AND s.provider='yahoo' WHERE i.id=${id}::uuid`,
          )
        ).rows[0],
    );
    if (!row) throw new ProblemError("NOT_FOUND");
    return z
      .object({ id: z.uuid(), currency: z.string(), mic: z.string(), symbol: z.string() })
      .strict()
      .parse(row);
  }
  async settlement(mic: "XWAR" | "XNYS" | "XNAS", tradeDate: string): Promise<string> {
    dateText.parse(tradeDate);
    const rows = await this.database.transaction(
      system,
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT session_date::text AS date,is_open AS "isOpen",notes FROM market.trading_calendar WHERE mic=${mic} AND session_date BETWEEN ${tradeDate}::date AND ${addDays(tradeDate, 31)}::date`,
          )
        ).rows,
    );
    const region = settlementRegionForMic(mic);
    if (!region) throw new ProblemError("VALIDATION_FAILED");
    return settlementDate(tradeDate, settlementCycleDays(region, tradeDate), (date) => {
      const day = rows.find((row) => row.date === date);
      if (!day) throw new ProblemError("VALIDATION_FAILED");
      return Boolean(day.isOpen) && !String(day.notes ?? "").includes("[settlement:closed]");
    });
  }
  async saveQuote(tx: DatabaseTransaction, value: Quote) {
    const quote = quoteSchema.parse(value);
    // A stale fallback must never refresh the freshness clock or overwrite a newer real quote.
    if (quote.meta.stale) return;
    await tx.execute(sql`INSERT INTO market.quotes_latest(instrument_id,price,prev_close,change,volume,as_of,delay_minutes,source,fetched_at)
      VALUES(${quote.instrumentId}::uuid,${quote.price},${quote.prevClose ?? null},${quote.change ?? null},${quote.volume ?? null},${quote.meta.asOf}::timestamptz,${quote.meta.delayMinutes},${quote.meta.source},${quote.fetchedAt}::timestamptz)
      ON CONFLICT(instrument_id) DO UPDATE SET price=EXCLUDED.price,prev_close=EXCLUDED.prev_close,change=EXCLUDED.change,volume=EXCLUDED.volume,as_of=EXCLUDED.as_of,delay_minutes=EXCLUDED.delay_minutes,source=EXCLUDED.source,fetched_at=EXCLUDED.fetched_at WHERE EXCLUDED.as_of>=market.quotes_latest.as_of`);
  }
  async saveBar(tx: DatabaseTransaction, input: Bar) {
    const bar = barSchema.parse(input);
    // Serialize writers per instrument, so concurrent batches cannot lose a quality report.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${bar.instrumentId},0))`);
    const previous = (
      await tx.execute(
        sql`SELECT close::text FROM market.bars_daily WHERE instrument_id=${bar.instrumentId}::uuid AND session_date<${bar.date}::date AND NOT no_trades ORDER BY session_date DESC LIMIT 1`,
      )
    ).rows[0];
    const action =
      (
        await tx.execute(
          sql`SELECT 1 FROM market.corporate_actions WHERE instrument_id=${bar.instrumentId}::uuid AND ex_date=${bar.date}::date LIMIT 1`,
        )
      ).rows.length > 0;
    for (const code of inspectMarketBar(bar, previous ? String(previous.close) : null, action))
      await this.recordQualityIssue(tx, bar.instrumentId, bar.date, code);
    // SQL forbids negative volume. Keep last good data and the persistent hold instead.
    if (bar.volume.startsWith("-")) return;
    await tx.execute(sql`INSERT INTO market.bars_daily(instrument_id,session_date,open,high,low,close,volume,turnover,no_trades,adjustment_factor,source,ingested_at)
      VALUES(${bar.instrumentId}::uuid,${bar.date}::date,${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume},${bar.turnover ?? null},${bar.noTrades},${bar.adjustmentFactor},${bar.meta.source},${bar.fetchedAt}::timestamptz)
      ON CONFLICT(instrument_id,session_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,turnover=EXCLUDED.turnover,no_trades=EXCLUDED.no_trades,source=EXCLUDED.source,ingested_at=EXCLUDED.ingested_at`);
  }
  async recordQualityIssue(tx: DatabaseTransaction, id: string, date: string, code: string) {
    await tx.execute(sql`INSERT INTO market.data_quality_issues(instrument_id,session_date,check_code,severity)
      SELECT ${id}::uuid,${date}::date,${code},'BLOCK' WHERE NOT EXISTS(SELECT 1 FROM market.data_quality_issues WHERE instrument_id=${id}::uuid AND session_date=${date}::date AND check_code=${code})`);
  }
  async saveBars(input: Bar[]) {
    const bars = z.array(barSchema).max(50_000).parse(input);
    await this.database.transaction(system, async (tx) => {
      const seen = new Set<string>();
      for (const bar of bars.sort(
        (a, b) => a.instrumentId.localeCompare(b.instrumentId) || a.date.localeCompare(b.date),
      )) {
        const key = `${bar.instrumentId}:${bar.date}`;
        if (seen.has(key)) {
          await this.recordQualityIssue(tx, bar.instrumentId, bar.date, "duplicate");
          continue;
        }
        seen.add(key);
        await this.saveBar(tx, bar);
      }
    });
  }
  async analysisEligible(context: DatabaseContext, id: string) {
    return this.database.transaction(
      context,
      async (tx) =>
        !(
          await tx.execute(
            sql`SELECT 1 FROM market.data_quality_issues WHERE instrument_id=${id}::uuid AND status='open' AND severity='BLOCK' LIMIT 1`,
          )
        ).rows.length,
    );
  }
}
