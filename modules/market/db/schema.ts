// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const marketSchema = pgSchema("market");

export const marketBarsDaily = marketSchema.table(
  "bars_daily",
  {
    instrumentId: uuid("instrument_id").notNull(),
    sessionDate: date("session_date", { mode: "string" }).notNull(),
    open: numeric("open", { precision: 20, scale: 8 }),
    high: numeric("high", { precision: 20, scale: 8 }),
    low: numeric("low", { precision: 20, scale: 8 }),
    close: numeric("close", { precision: 20, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 24, scale: 4 }).notNull().default(sql`0`),
    turnover: numeric("turnover", { precision: 24, scale: 4 }),
    trades: integer("trades"),
    noTrades: boolean("no_trades").notNull().default(sql`false`),
    adjustmentFactor: numeric("adjustment_factor", { precision: 24, scale: 12 })
      .notNull()
      .default(sql`1`),
    source: text("source").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "bars_daily_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({ name: "bars_daily_pkey", columns: [table.instrumentId, table.sessionDate] }),
    check("bars_daily_volume_check", sql`((volume >= (0)::numeric))`),
    index("bars_daily_session_date_brin").using("brin", sql`session_date`),
  ],
);

export const marketBarsIntraday = marketSchema.table(
  "bars_intraday",
  {
    instrumentId: uuid("instrument_id").notNull(),
    interval: text("interval").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "string" }).notNull(),
    open: numeric("open", { precision: 20, scale: 8 }),
    high: numeric("high", { precision: 20, scale: 8 }),
    low: numeric("low", { precision: 20, scale: 8 }),
    close: numeric("close", { precision: 20, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 24, scale: 4 }).notNull().default(sql`0`),
    source: text("source").notNull(),
  },
  (table) => [
    foreignKey({
      name: "bars_intraday_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "bars_intraday_interval_check",
      sql`(("interval" = ANY (ARRAY['5m'::text, '15m'::text, '1h'::text])))`,
    ),
    primaryKey({
      name: "bars_intraday_pkey",
      columns: [table.instrumentId, table.interval, table.ts],
    }),
  ],
);

export const marketCalendarEvents = marketSchema.table(
  "calendar_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    instrumentId: uuid("instrument_id"),
    type: text("type").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventTime: time("event_time"),
    title: text("title").notNull(),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    source: text("source").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "calendar_events_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "calendar_events_source_check",
      sql`((source = ANY (ARRAY['alphavantage'::text, 'fmp'::text, 'fred'::text, 'admin'::text])))`,
    ),
    check(
      "calendar_events_type_check",
      sql`((type = ANY (ARRAY['earnings'::text, 'macro'::text, 'dividend'::text, 'other'::text])))`,
    ),
    index("calendar_events_date_idx").using("btree", sql`event_date`),
  ],
);

export const marketCorporateActions = marketSchema.table(
  "corporate_actions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    instrumentId: uuid("instrument_id").notNull(),
    type: text("type").notNull(),
    exDate: date("ex_date", { mode: "string" }).notNull(),
    recordDate: date("record_date", { mode: "string" }),
    payDate: date("pay_date", { mode: "string" }),
    ratio: numeric("ratio", { precision: 24, scale: 12 }),
    amount: numeric("amount", { precision: 20, scale: 8 }),
    currency: char("currency", { length: 3 }),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    source: text("source").notNull(),
    confirmedBy: uuid("confirmed_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "corporate_actions_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "corporate_actions_type_check",
      sql`((type = ANY (ARRAY['split'::text, 'reverse_split'::text, 'dividend'::text, 'isin_change'::text, 'name_change'::text, 'delisting'::text, 'rights_issue'::text])))`,
    ),
    index("corporate_actions_instrument_idx").using("btree", sql`instrument_id`, sql`ex_date`),
  ],
);

export const marketDataQualityIssues = marketSchema.table(
  "data_quality_issues",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    instrumentId: uuid("instrument_id").notNull(),
    sessionDate: date("session_date", { mode: "string" }),
    checkCode: text("check_code").notNull(),
    severity: text("severity").notNull(),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default(sql`'open'::text`),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "data_quality_issues_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "data_quality_issues_severity_check",
      sql`((severity = ANY (ARRAY['BLOCK'::text, 'WARN'::text, 'INFO'::text])))`,
    ),
    check(
      "data_quality_issues_status_check",
      sql`((status = ANY (ARRAY['open'::text, 'resolved'::text, 'ignored'::text])))`,
    ),
    index("data_quality_issues_open_idx")
      .using("btree", sql`instrument_id`)
      .where(sql`(status = 'open'::text)`),
  ],
);

export const marketFundamentalsSnapshots = marketSchema.table(
  "fundamentals_snapshots",
  {
    instrumentId: uuid("instrument_id").notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    periodType: text("period_type").notNull(),
    data: jsonb("data").notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "fundamentals_snapshots_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "fundamentals_snapshots_period_type_check",
      sql`((period_type = ANY (ARRAY['Q'::text, 'Y'::text])))`,
    ),
    primaryKey({
      name: "fundamentals_snapshots_pkey",
      columns: [table.instrumentId, table.periodEnd, table.periodType],
    }),
  ],
);

export const marketFxRates = marketSchema.table(
  "fx_rates",
  {
    base: char("base", { length: 3 }).notNull(),
    quote: char("quote", { length: 3 }).notNull(),
    rateDate: date("rate_date", { mode: "string" }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    source: text("source").notNull(),
    tableNo: text("table_no"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: "fx_rates_pkey",
      columns: [table.base, table.quote, table.rateDate, table.source],
    }),
    check("fx_rates_rate_check", sql`((rate > (0)::numeric))`),
    check("fx_rates_source_check", sql`((source = ANY (ARRAY['nbp'::text, 'ecb'::text])))`),
  ],
);

export const marketInstrumentProviderSymbols = marketSchema.table(
  "instrument_provider_symbols",
  {
    provider: text("provider").notNull(),
    symbol: text("symbol").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "instrument_provider_symbols_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "instrument_provider_symbols_pkey",
      columns: [table.provider, table.symbol],
    }),
    check(
      "instrument_provider_symbols_provider_check",
      sql`((provider = ANY (ARRAY['gpw'::text, 'yahoo'::text, 'stooq'::text, 'finnhub'::text, 'twelvedata'::text, 'alphavantage'::text, 'fmp'::text, 'eodhd'::text, 'xtb'::text, 'mbank'::text, 'openfigi'::text])))`,
    ),
    index("instrument_provider_symbols_instrument_idx").using("btree", sql`instrument_id`),
  ],
);

export const marketInstruments = marketSchema.table(
  "instruments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    isin: text("isin"),
    mic: text("mic").notNull(),
    ticker: text("ticker"),
    exchangeShortName: text("exchange_short_name"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    country: char("country", { length: 2 }),
    assetClass: text("asset_class").notNull().default(sql`'equity'::text`),
    sectorCode: text("sector_code"),
    lotSize: numeric("lot_size", { precision: 24, scale: 10 }).notNull().default(sql`1`),
    supportsFractional: boolean("supports_fractional").notNull().default(sql`false`),
    isActive: boolean("is_active").notNull().default(sql`true`),
    delistedOn: date("delisted_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (_table) => [
    check(
      "instruments_asset_class_check",
      sql`((asset_class = ANY (ARRAY['equity'::text, 'bond'::text, 'commodity'::text, 'cash'::text, 'fx'::text, 'crypto'::text, 'real_estate'::text, 'other'::text])))`,
    ),
    check("instruments_isin_check", sql`((isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'::text))`),
    check(
      "instruments_type_check",
      sql`((type = ANY (ARRAY['stock'::text, 'etf'::text, 'etc'::text, 'etn'::text, 'index'::text, 'fx'::text, 'commodity'::text, 'bond'::text, 'fund'::text, 'crypto'::text])))`,
    ),
    uniqueIndex("instruments_isin_mic_uq")
      .using("btree", sql`isin`, sql`mic`)
      .where(sql`(isin IS NOT NULL)`),
    uniqueIndex("instruments_mic_ticker_uq")
      .using("btree", sql`mic`, sql`ticker`)
      .where(sql`(ticker IS NOT NULL)`),
    index("instruments_name_idx").using("btree", sql`lower(name)`),
  ],
);

export const marketMacroObservations = marketSchema.table(
  "macro_observations",
  {
    seriesId: uuid("series_id").notNull(),
    obsDate: date("obs_date", { mode: "string" }).notNull(),
    value: numeric("value", { precision: 20, scale: 8 }).notNull(),
  },
  (table) => [
    primaryKey({ name: "macro_observations_pkey", columns: [table.seriesId, table.obsDate] }),
    foreignKey({
      name: "macro_observations_series_id_fkey",
      columns: [table.seriesId],
      foreignColumns: [marketMacroSeries.id],
    }).onDelete("cascade"),
  ],
);

export const marketMacroSeries = marketSchema.table(
  "macro_series",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    frequency: text("frequency").notNull(),
    source: text("source").notNull(),
  },
  (table) => [
    unique("macro_series_code_key").on(table.code),
    check(
      "macro_series_frequency_check",
      sql`((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, 'annual'::text, 'event'::text])))`,
    ),
    check(
      "macro_series_source_check",
      sql`((source = ANY (ARRAY['fred'::text, 'nbp'::text, 'admin'::text])))`,
    ),
  ],
);

export const marketNewsItems = marketSchema.table(
  "news_items",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    instrumentId: uuid("instrument_id"),
    market: text("market"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    sourceDomain: text("source_domain").notNull(),
    language: text("language"),
    tone: doublePrecision("tone"),
    sentimentScore: doublePrecision("sentiment_score"),
    sentimentSource: text("sentiment_source"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "news_items_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    unique("news_items_url_key").on(table.url),
    index("news_items_instrument_idx").using("btree", sql`instrument_id`, sql`published_at`),
  ],
);

export const marketQuotesLatest = marketSchema.table(
  "quotes_latest",
  {
    instrumentId: uuid("instrument_id").primaryKey(),
    price: numeric("price", { precision: 20, scale: 8 }).notNull(),
    prevClose: numeric("prev_close", { precision: 20, scale: 8 }),
    change: numeric("change", { precision: 20, scale: 8 }),
    changePct: doublePrecision("change_pct"),
    volume: numeric("volume", { precision: 24, scale: 4 }),
    asOf: timestamp("as_of", { withTimezone: true, mode: "string" }).notNull(),
    delayMinutes: integer("delay_minutes").notNull().default(sql`15`),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "quotes_latest_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
  ],
);

export const marketScreenerPresets = marketSchema.table(
  "screener_presets",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    universe: text("universe").notNull().default(sql`'gpw_all'::text`),
    criteria: jsonb("criteria").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "screener_presets_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("screener_presets_user_id_name_key").on(table.userId, table.name),
  ],
);

export const marketSectorMemberships = marketSchema.table(
  "sector_memberships",
  {
    instrumentId: uuid("instrument_id").notNull(),
    sectorCode: text("sector_code").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
    source: text("source").notNull(),
  },
  (table) => [
    foreignKey({
      name: "sector_memberships_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "sector_memberships_pkey",
      columns: [table.instrumentId, table.sectorCode, table.validFrom],
    }),
    foreignKey({
      name: "sector_memberships_sector_code_fkey",
      columns: [table.sectorCode],
      foreignColumns: [marketSectors.code],
    }).onDelete("no action"),
  ],
);

export const marketSectors = marketSchema.table(
  "sectors",
  {
    code: text("code").primaryKey(),
    scheme: text("scheme").notNull(),
    namePl: text("name_pl").notNull(),
    nameEn: text("name_en"),
  },
  (_table) => [
    check(
      "sectors_scheme_check",
      sql`((scheme = ANY (ARRAY['gpw_subindex'::text, 'provider'::text])))`,
    ),
  ],
);

export const marketTradingCalendar = marketSchema.table(
  "trading_calendar",
  {
    mic: text("mic").notNull(),
    sessionDate: date("session_date", { mode: "string" }).notNull(),
    isOpen: boolean("is_open").notNull(),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    timezone: text("timezone").notNull(),
    notes: text("notes"),
  },
  (table) => [
    primaryKey({ name: "trading_calendar_pkey", columns: [table.mic, table.sessionDate] }),
  ],
);

export const marketUniverseMembers = marketSchema.table(
  "universe_members",
  {
    universeId: uuid("universe_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "universe_members_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({
      name: "universe_members_pkey",
      columns: [table.universeId, table.instrumentId, table.validFrom],
    }),
    foreignKey({
      name: "universe_members_universe_id_fkey",
      columns: [table.universeId],
      foreignColumns: [marketUniverses.id],
    }).onDelete("cascade"),
  ],
);

export const marketUniverses = marketSchema.table(
  "universes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [unique("universes_code_key").on(table.code)],
);

export const marketWatchlistItems = marketSchema.table(
  "watchlist_items",
  {
    watchlistId: uuid("watchlist_id").notNull(),
    userId: uuid("user_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    position: integer("position").notNull().default(sql`0`),
    note: text("note"),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "watchlist_items_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({ name: "watchlist_items_pkey", columns: [table.watchlistId, table.instrumentId] }),
    foreignKey({
      name: "watchlist_items_watchlist_id_user_id_fkey",
      columns: [table.watchlistId, table.userId],
      foreignColumns: [marketWatchlists.id, marketWatchlists.userId],
    }).onDelete("cascade"),
  ],
);

export const marketWatchlists = marketSchema.table(
  "watchlists",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(sql`0`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("watchlists_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "watchlists_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("watchlists_user_id_name_key").on(table.userId, table.name),
  ],
);
