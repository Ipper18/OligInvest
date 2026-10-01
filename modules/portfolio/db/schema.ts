// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { marketInstruments } from "@oliginvest/mod-market/server";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

export const portfolioSchema = pgSchema("portfolio");

export const portfolioAccounts = portfolioSchema.table(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    broker: text("broker").notNull(),
    accountType: text("account_type").notNull().default(sql`'regular'::text`),
    currency: char("currency", { length: 3 }).notNull(),
    externalRef: text("external_ref"),
    openedOn: date("opened_on", { mode: "string" }),
    closedOn: date("closed_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "accounts_account_type_check",
      sql`((account_type = ANY (ARRAY['regular'::text, 'ike'::text, 'ikze'::text, 'demo'::text])))`,
    ),
    check(
      "accounts_broker_check",
      sql`((broker = ANY (ARRAY['xtb'::text, 'mbank'::text, 'other'::text, 'demo'::text])))`,
    ),
    unique("accounts_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "accounts_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("accounts_user_id_name_key").on(table.userId, table.name),
  ],
);

export const portfolioCashBalancesDaily = portfolioSchema.table(
  "cash_balances_daily",
  {
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    valuationDate: date("valuation_date", { mode: "string" }).notNull(),
    balance: numeric("balance", { precision: 20, scale: 8 }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "cash_balances_daily_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    primaryKey({
      name: "cash_balances_daily_pkey",
      columns: [table.accountId, table.currency, table.valuationDate],
    }),
  ],
);

export const portfolioImportBatches = portfolioSchema.table(
  "import_batches",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    source: text("source").notNull(),
    formatDetected: text("format_detected"),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    status: text("status").notNull().default(sql`'uploaded'::text`),
    summary: jsonb("summary"),
    reconciliation: jsonb("reconciliation"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    parsedAt: timestamp("parsed_at", { withTimezone: true, mode: "string" }),
    committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "import_batches_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    unique("import_batches_id_user_id_key").on(table.id, table.userId),
    check(
      "import_batches_source_check",
      sql`((source = ANY (ARRAY['xtb'::text, 'mbank'::text, 'generic'::text])))`,
    ),
    check(
      "import_batches_status_check",
      sql`((status = ANY (ARRAY['uploaded'::text, 'parsing'::text, 'parsed'::text, 'committed'::text, 'discarded'::text, 'failed'::text])))`,
    ),
    uniqueIndex("import_batches_active_file_uq")
      .using("btree", sql`account_id`, sql`file_sha256`)
      .where(sql`(status <> 'discarded'::text)`),
  ],
);

export const portfolioImportFiles = portfolioSchema.table(
  "import_files",
  {
    batchId: uuid("batch_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    content: bytea("content").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "import_files_batch_id_user_id_fkey",
      columns: [table.batchId, table.userId],
      foreignColumns: [portfolioImportBatches.id, portfolioImportBatches.userId],
    }).onDelete("cascade"),
    check("import_files_size_bytes_check", sql`((size_bytes <= 10485760))`),
  ],
);

export const portfolioImportRows = portfolioSchema.table(
  "import_rows",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    batchId: uuid("batch_id").notNull(),
    userId: uuid("user_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    sheet: text("sheet"),
    raw: jsonb("raw").notNull(),
    normalized: jsonb("normalized"),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    dedupeKey: text("dedupe_key").notNull(),
    instrumentId: uuid("instrument_id"),
    transactionId: uuid("transaction_id"),
  },
  (table) => [
    foreignKey({
      name: "import_rows_batch_id_user_id_fkey",
      columns: [table.batchId, table.userId],
      foreignColumns: [portfolioImportBatches.id, portfolioImportBatches.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "import_rows_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("no action"),
    check(
      "import_rows_status_check",
      sql`((status = ANY (ARRAY['new'::text, 'duplicate'::text, 'unsupported'::text, 'needs_mapping'::text, 'error'::text, 'skipped'::text])))`,
    ),
    index("import_rows_batch_idx").using("btree", sql`batch_id`, sql`status`),
  ],
);

export const portfolioImportTemplates = portfolioSchema.table(
  "import_templates",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    sourceHint: text("source_hint"),
    mapping: jsonb("mapping").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "import_templates_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("import_templates_user_id_name_key").on(table.userId, table.name),
  ],
);

export const portfolioInstrumentOverrides = portfolioSchema.table(
  "instrument_overrides",
  {
    userId: uuid("user_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    assetClass: text("asset_class"),
    sectorCode: text("sector_code"),
    country: char("country", { length: 2 }),
    note: text("note"),
  },
  (table) => [
    foreignKey({
      name: "instrument_overrides_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    primaryKey({ name: "instrument_overrides_pkey", columns: [table.userId, table.instrumentId] }),
    foreignKey({
      name: "instrument_overrides_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const portfolioJournalEntries = portfolioSchema.table(
  "journal_entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id"),
    instrumentId: uuid("instrument_id"),
    transactionId: uuid("transaction_id"),
    analyticsRunId: uuid("analytics_run_id"),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    thesis: text("thesis").notNull(),
    horizon: text("horizon"),
    plannedExit: numeric("planned_exit", { precision: 20, scale: 8 }),
    plannedRisk: numeric("planned_risk", { precision: 20, scale: 8 }),
    confidence: smallint("confidence"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    emotion: text("emotion"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check("journal_entries_confidence_check", sql`(((confidence >= 1) AND (confidence <= 5)))`),
    unique("journal_entries_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "journal_entries_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("no action"),
    foreignKey({
      name: "journal_entries_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const portfolioJournalPostmortems = portfolioSchema.table(
  "journal_postmortems",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    journalEntryId: uuid("journal_entry_id").notNull(),
    userId: uuid("user_id").notNull(),
    closedOn: date("closed_on", { mode: "string" }),
    processScore: smallint("process_score"),
    outcomeScore: smallint("outcome_score"),
    wentWell: text("went_well"),
    wentWrong: text("went_wrong"),
    lessons: text("lessons"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("journal_postmortems_journal_entry_id_key").on(table.journalEntryId),
    foreignKey({
      name: "journal_postmortems_journal_entry_id_user_id_fkey",
      columns: [table.journalEntryId, table.userId],
      foreignColumns: [portfolioJournalEntries.id, portfolioJournalEntries.userId],
    }).onDelete("cascade"),
    check(
      "journal_postmortems_outcome_score_check",
      sql`(((outcome_score >= 1) AND (outcome_score <= 5)))`,
    ),
    check(
      "journal_postmortems_process_score_check",
      sql`(((process_score >= 1) AND (process_score <= 5)))`,
    ),
  ],
);

export const portfolioLotConsumptions = portfolioSchema.table(
  "lot_consumptions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    lotId: uuid("lot_id").notNull(),
    closeTransactionId: uuid("close_transaction_id").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 10 }).notNull(),
    costEconomic: numeric("cost_economic", { precision: 20, scale: 8 }).notNull(),
    proceedsEconomic: numeric("proceeds_economic", { precision: 20, scale: 8 }).notNull(),
    realizedPlEconomic: numeric("realized_pl_economic", { precision: 20, scale: 8 }).notNull(),
    costTaxPln: numeric("cost_tax_pln", { precision: 20, scale: 8 }),
    proceedsTaxPln: numeric("proceeds_tax_pln", { precision: 20, scale: 8 }),
    realizedPlTaxPln: numeric("realized_pl_tax_pln", { precision: 20, scale: 8 }),
    fxCostPln: numeric("fx_cost_pln", { precision: 20, scale: 8 }),
    closedOn: date("closed_on", { mode: "string" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "lot_consumptions_close_transaction_id_user_id_fkey",
      columns: [table.closeTransactionId, table.userId],
      foreignColumns: [portfolioTransactions.id, portfolioTransactions.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lot_consumptions_lot_id_user_id_fkey",
      columns: [table.lotId, table.userId],
      foreignColumns: [portfolioLots.id, portfolioLots.userId],
    }).onDelete("cascade"),
    check("lot_consumptions_quantity_check", sql`((quantity > (0)::numeric))`),
    index("lot_consumptions_user_date_idx").using("btree", sql`user_id`, sql`closed_on`),
  ],
);

export const portfolioLots = portfolioSchema.table(
  "lots",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    openTransactionId: uuid("open_transaction_id").notNull(),
    acquiredOn: date("acquired_on", { mode: "string" }).notNull(),
    quantityOpen: numeric("quantity_open", { precision: 24, scale: 10 }).notNull(),
    quantityRemaining: numeric("quantity_remaining", { precision: 24, scale: 10 }).notNull(),
    costTotal: numeric("cost_total", { precision: 20, scale: 8 }).notNull(),
    costCurrency: char("cost_currency", { length: 3 }).notNull(),
    costTotalInstrumentCcy: numeric("cost_total_instrument_ccy", { precision: 20, scale: 8 }),
    costTotalTaxPln: numeric("cost_total_tax_pln", { precision: 20, scale: 8 }),
    feesTotal: numeric("fees_total", { precision: 20, scale: 8 }).notNull().default(sql`0`),
    fxFeeTotal: numeric("fx_fee_total", { precision: 20, scale: 8 }).notNull().default(sql`0`),
    splitFactor: numeric("split_factor", { precision: 24, scale: 12 }).notNull().default(sql`1`),
    closedOn: date("closed_on", { mode: "string" }),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "lots_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    unique("lots_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "lots_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("no action"),
    foreignKey({
      name: "lots_open_transaction_id_user_id_fkey",
      columns: [table.openTransactionId, table.userId],
      foreignColumns: [portfolioTransactions.id, portfolioTransactions.userId],
    }).onDelete("cascade"),
    check("lots_quantity_open_check", sql`((quantity_open > (0)::numeric))`),
    check("lots_quantity_remaining_check", sql`((quantity_remaining >= (0)::numeric))`),
    index("lots_fifo_idx")
      .using("btree", sql`account_id`, sql`instrument_id`, sql`acquired_on`)
      .where(sql`(quantity_remaining > (0)::numeric)`),
  ],
);

export const portfolioPositionsDaily = portfolioSchema.table(
  "positions_daily",
  {
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    instrumentId: uuid("instrument_id").notNull(),
    valuationDate: date("valuation_date", { mode: "string" }).notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 10 }).notNull(),
    costBasis: numeric("cost_basis", { precision: 20, scale: 8 }).notNull(),
    price: numeric("price", { precision: 20, scale: 8 }),
    priceCurrency: char("price_currency", { length: 3 }),
    priceAsOf: timestamp("price_as_of", { withTimezone: true, mode: "string" }),
    fxRateToAccount: numeric("fx_rate_to_account", { precision: 18, scale: 8 }),
    marketValue: numeric("market_value", { precision: 20, scale: 8 }),
    marketValuePln: numeric("market_value_pln", { precision: 20, scale: 8 }),
    unrealizedPlPln: numeric("unrealized_pl_pln", { precision: 20, scale: 8 }),
  },
  (table) => [
    foreignKey({
      name: "positions_daily_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "positions_daily_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("no action"),
    primaryKey({
      name: "positions_daily_pkey",
      columns: [table.accountId, table.instrumentId, table.valuationDate],
    }),
    index("positions_daily_user_date_idx").using("btree", sql`user_id`, sql`valuation_date`),
  ],
);

export const portfolioTargetAllocations = portfolioSchema.table(
  "target_allocations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    accountId: uuid("account_id"),
    targets: jsonb("targets").notNull(),
    tolerancePp: numeric("tolerance_pp", { precision: 6, scale: 3 }).notNull().default(sql`5`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "target_allocations_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "target_allocations_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("target_allocations_user_id_name_key").on(table.userId, table.name),
  ],
);

export const portfolioTransactions = portfolioSchema.table(
  "transactions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    type: text("type").notNull(),
    tradeDate: date("trade_date", { mode: "string" }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "string" }),
    settleDate: date("settle_date", { mode: "string" }),
    sequence: integer("sequence").notNull().default(sql`0`),
    instrumentId: uuid("instrument_id"),
    quantity: numeric("quantity", { precision: 24, scale: 10 }),
    price: numeric("price", { precision: 20, scale: 8 }),
    priceCurrency: char("price_currency", { length: 3 }),
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    cashCurrency: char("cash_currency", { length: 3 }).notNull(),
    fee: numeric("fee", { precision: 20, scale: 8 }).notNull().default(sql`0`),
    feeCurrency: char("fee_currency", { length: 3 }),
    tax: numeric("tax", { precision: 20, scale: 8 }).notNull().default(sql`0`),
    taxCurrency: char("tax_currency", { length: 3 }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
    fxSource: text("fx_source"),
    splitRatio: numeric("split_ratio", { precision: 24, scale: 12 }),
    counterAmount: numeric("counter_amount", { precision: 20, scale: 8 }),
    counterCurrency: char("counter_currency", { length: 3 }),
    category: text("category"),
    relatedTransactionId: uuid("related_transaction_id"),
    source: text("source").notNull(),
    importBatchId: uuid("import_batch_id"),
    externalId: text("external_id"),
    createdByApiKey: uuid("created_by_api_key"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "transactions_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    check(
      "transactions_fx_source_check",
      sql`((fx_source = ANY (ARRAY['broker'::text, 'implied'::text, 'nbp_fallback'::text, 'manual'::text])))`,
    ),
    unique("transactions_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "transactions_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("no action"),
    check(
      "transactions_source_check",
      sql`((source = ANY (ARRAY['manual'::text, 'import'::text, 'quick'::text, 'demo'::text])))`,
    ),
    check(
      "transactions_type_check",
      sql`((type = ANY (ARRAY['BUY'::text, 'SELL'::text, 'DIVIDEND'::text, 'INTEREST'::text, 'FEE'::text, 'TAX'::text, 'DEPOSIT'::text, 'WITHDRAWAL'::text, 'CASH_TRANSFER_IN'::text, 'CASH_TRANSFER_OUT'::text, 'FX_CONVERSION'::text, 'SPLIT'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text, 'ADJUSTMENT'::text])))`,
    ),
    check(
      "tx_fx_legs",
      sql`(((type <> 'FX_CONVERSION'::text) OR ((counter_amount IS NOT NULL) AND (counter_currency IS NOT NULL))))`,
    ),
    check(
      "tx_instrument_required",
      sql`(((type <> ALL (ARRAY['BUY'::text, 'SELL'::text, 'DIVIDEND'::text, 'SPLIT'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text])) OR (instrument_id IS NOT NULL)))`,
    ),
    check(
      "tx_quantity_positive",
      sql`(((type <> ALL (ARRAY['BUY'::text, 'SELL'::text, 'SECURITY_TRANSFER_IN'::text, 'SECURITY_TRANSFER_OUT'::text])) OR ((quantity IS NOT NULL) AND (quantity > (0)::numeric))))`,
    ),
    check(
      "tx_split_ratio",
      sql`(((type <> 'SPLIT'::text) OR ((split_ratio IS NOT NULL) AND (split_ratio > (0)::numeric))))`,
    ),
    index("transactions_account_date_idx").using(
      "btree",
      sql`account_id`,
      sql`trade_date`,
      sql`sequence`,
    ),
    uniqueIndex("transactions_external_uq")
      .using("btree", sql`account_id`, sql`source`, sql`external_id`)
      .where(sql`(external_id IS NOT NULL)`),
    index("transactions_instrument_idx").using(
      "btree",
      sql`account_id`,
      sql`instrument_id`,
      sql`trade_date`,
    ),
    index("transactions_user_date_idx").using("btree", sql`user_id`, sql`trade_date`),
  ],
);

export const portfolioValuationsDaily = portfolioSchema.table(
  "valuations_daily",
  {
    userId: uuid("user_id").notNull(),
    accountId: uuid("account_id").notNull(),
    valuationDate: date("valuation_date", { mode: "string" }).notNull(),
    marketValue: numeric("market_value", { precision: 20, scale: 8 }).notNull(),
    cash: numeric("cash", { precision: 20, scale: 8 }).notNull(),
    totalValue: numeric("total_value", { precision: 20, scale: 8 }).notNull(),
    totalValuePln: numeric("total_value_pln", { precision: 20, scale: 8 }).notNull(),
    externalFlow: numeric("external_flow", { precision: 20, scale: 8 }).notNull().default(sql`0`),
    externalFlowPln: numeric("external_flow_pln", { precision: 20, scale: 8 })
      .notNull()
      .default(sql`0`),
    fxRateToPln: numeric("fx_rate_to_pln", { precision: 18, scale: 8 }),
    asOf: timestamp("as_of", { withTimezone: true, mode: "string" }).notNull(),
    isComplete: boolean("is_complete").notNull().default(sql`true`),
  },
  (table) => [
    foreignKey({
      name: "valuations_daily_account_id_user_id_fkey",
      columns: [table.accountId, table.userId],
      foreignColumns: [portfolioAccounts.id, portfolioAccounts.userId],
    }).onDelete("cascade"),
    primaryKey({ name: "valuations_daily_pkey", columns: [table.accountId, table.valuationDate] }),
    index("valuations_daily_user_date_idx").using("btree", sql`user_id`, sql`valuation_date`),
  ],
);
