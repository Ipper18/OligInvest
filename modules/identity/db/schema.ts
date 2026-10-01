// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

export const authSchema = pgSchema("auth");
export const identitySchema = pgSchema("identity");

export const authAccounts = authSchema.table(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer"),
    userId: uuid("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("accounts_provider_id_account_id_key").on(table.providerId, table.accountId),
    foreignKey({
      name: "accounts_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("accounts_user_id_idx").using("btree", sql`user_id`),
  ],
);

export const authApiKeys = authSchema.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    configId: text("config_id").notNull().default(sql`'default'::text`),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: uuid("reference_id").notNull(),
    refillInterval: bigint("refill_interval", { mode: "bigint" }),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { withTimezone: true, mode: "string" }),
    enabled: boolean("enabled").notNull().default(sql`true`),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(sql`true`),
    rateLimitTimeWindow: bigint("rate_limit_time_window", { mode: "bigint" }),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(sql`0`),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { withTimezone: true, mode: "string" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    foreignKey({
      name: "api_keys_reference_id_fkey",
      columns: [table.referenceId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("api_keys_key_idx").using("btree", sql`key`),
    index("api_keys_reference_id_idx").using("btree", sql`reference_id`),
  ],
);

export const authRateLimits = authSchema.table(
  "rate_limits",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "bigint" }).notNull(),
  },
  (table) => [unique("rate_limits_key_key").on(table.key)],
);

export const authSessions = authSchema.table(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id").notNull(),
    impersonatedBy: uuid("impersonated_by"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    unique("sessions_token_key").on(table.token),
    foreignKey({
      name: "sessions_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("sessions_user_id_idx").using("btree", sql`user_id`),
  ],
);

export const authTwoFactors = authSchema.table(
  "two_factors",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id").notNull(),
    verified: boolean("verified").default(sql`true`),
    failedVerificationCount: integer("failed_verification_count").default(sql`0`),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "two_factors_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("two_factors_user_id_idx").using("btree", sql`user_id`),
  ],
);

export const authUsers = authSchema.table(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(sql`false`),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    role: text("role").notNull().default(sql`'user'::text`),
    banned: boolean("banned").notNull().default(sql`false`),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true, mode: "string" }),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(sql`false`),
  },
  (table) => [
    check("users_email_check", sql`((email = lower(email)))`),
    unique("users_email_key").on(table.email),
    check(
      "users_role_check",
      sql`((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text])))`,
    ),
  ],
);

export const authVerifications = authSchema.table(
  "verifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (_table) => [index("verifications_identifier_idx").using("btree", sql`identifier`)],
);

export const identityConsentEvents = identitySchema.table(
  "consent_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    document: text("document").notNull(),
    version: text("version").notNull(),
    action: text("action").notNull(),
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "consent_action_matches_document",
      sql`((((document = 'terms'::text) AND (action = 'accepted'::text)) OR ((document = 'privacy_notice'::text) AND (action = 'acknowledged'::text)) OR ((document = 'diagnostics'::text) AND (action = ANY (ARRAY['granted'::text, 'withdrawn'::text])))))`,
    ),
    check(
      "consent_events_document_check",
      sql`((document = ANY (ARRAY['terms'::text, 'privacy_notice'::text, 'diagnostics'::text])))`,
    ),
    check(
      "consent_events_source_check",
      sql`((source = ANY (ARRAY['sign_up'::text, 'gate'::text, 'settings'::text])))`,
    ),
    foreignKey({
      name: "consent_events_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    check(
      "consent_events_version_check",
      sql`((version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(\\.[0-9]{1,3})?$'::text))`,
    ),
    index("consent_events_user_doc_idx").using(
      "btree",
      sql`user_id`,
      sql`document`,
      table.recordedAt.desc().nullsFirst(),
    ),
  ],
);

export const identityDataExports = identitySchema.table(
  "data_exports",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    status: text("status").notNull().default(sql`'queued'::text`),
    content: bytea("content"),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    check(
      "data_exports_status_check",
      sql`((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'expired'::text])))`,
    ),
    foreignKey({
      name: "data_exports_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const identityDeletionRequests = identitySchema.table(
  "deletion_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "string" }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "deletion_requests_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const identityInvitations = identitySchema.table(
  "invitations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").notNull(),
    role: text("role").notNull().default(sql`'user'::text`),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    usedBy: uuid("used_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check("invitations_email_check", sql`((email = lower(email)))`),
    foreignKey({
      name: "invitations_invited_by_fkey",
      columns: [table.invitedBy],
      foreignColumns: [authUsers.id],
    }).onDelete("no action"),
    check(
      "invitations_role_check",
      sql`((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text])))`,
    ),
    unique("invitations_token_hash_key").on(table.tokenHash),
    foreignKey({
      name: "invitations_used_by_fkey",
      columns: [table.usedBy],
      foreignColumns: [authUsers.id],
    }).onDelete("no action"),
  ],
);

export const identityUserPreferences = identitySchema.table(
  "user_preferences",
  {
    userId: uuid("user_id").primaryKey(),
    baseCurrency: char("base_currency", { length: 3 }).notNull().default(sql`'PLN'::bpchar`),
    costBasisMethod: text("cost_basis_method").notNull().default(sql`'fifo'::text`),
    plView: text("pl_view").notNull().default(sql`'economic'::text`),
    timezone: text("timezone").notNull().default(sql`'Europe/Warsaw'::text`),
    locale: text("locale").notNull().default(sql`'pl-PL'::text`),
    theme: text("theme").notNull().default(sql`'system'::text`),
    plPalette: text("pl_palette").notNull().default(sql`'default'::text`),
    taxDateBasis: text("tax_date_basis").notNull().default(sql`'settlement'::text`),
    taxIncludeFxFee: boolean("tax_include_fx_fee").notNull().default(sql`false`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "user_preferences_cost_basis_method_check",
      sql`((cost_basis_method = ANY (ARRAY['fifo'::text, 'average'::text])))`,
    ),
    check(
      "user_preferences_pl_palette_check",
      sql`((pl_palette = ANY (ARRAY['default'::text, 'colorblind'::text])))`,
    ),
    check(
      "user_preferences_pl_view_check",
      sql`((pl_view = ANY (ARRAY['economic'::text, 'tax'::text])))`,
    ),
    check(
      "user_preferences_tax_date_basis_check",
      sql`((tax_date_basis = ANY (ARRAY['settlement'::text, 'trade'::text])))`,
    ),
    check(
      "user_preferences_theme_check",
      sql`((theme = ANY (ARRAY['system'::text, 'light'::text, 'dark'::text])))`,
    ),
    foreignKey({
      name: "user_preferences_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);
