// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

export const platformAuditLog = platformSchema.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    actorUserId: uuid("actor_user_id"),
    actorRef: text("actor_ref").notNull(),
    actorType: text("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    outcome: text("outcome").notNull().default(sql`'success'::text`),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (table) => [
    check(
      "audit_log_actor_type_check",
      sql`((actor_type = ANY (ARRAY['user'::text, 'admin'::text, 'system'::text, 'pat'::text])))`,
    ),
    check(
      "audit_log_outcome_check",
      sql`((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'error'::text])))`,
    ),
    index("audit_log_actor_idx").using(
      "btree",
      sql`actor_user_id`,
      table.occurredAt.desc().nullsFirst(),
    ),
    index("audit_log_occurred_at_idx").using("btree", table.occurredAt.desc().nullsFirst()),
  ],
);

export const platformErasureLog = platformSchema.table("erasure_log", {
  erasedUserId: uuid("erased_user_id").primaryKey(),
  erasedAt: timestamp("erased_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
  purgeAfter: timestamp("purge_after", { withTimezone: true, mode: "string" }).notNull(),
});

export const platformFeatureFlags = platformSchema.table("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(sql`false`),
  rules: jsonb("rules").notNull().default(sql`'{}'::jsonb`),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .default(sql`now()`),
});

export const platformIdempotencyKeys = platformSchema.table(
  "idempotency_keys",
  {
    userId: uuid("user_id").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [primaryKey({ name: "idempotency_keys_pkey", columns: [table.userId, table.key] })],
);

export const platformRoleLimits = platformSchema.table(
  "role_limits",
  {
    role: text("role").primaryKey(),
    limits: jsonb("limits").notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (_table) => [
    check(
      "role_limits_role_check",
      sql`((role = ANY (ARRAY['user'::text, 'pro'::text, 'admin'::text])))`,
    ),
  ],
);

export const platformWebVitals = platformSchema.table(
  "web_vitals",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    route: text("route").notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    rating: text("rating"),
    deviceClass: text("device_class"),
    connection: text("connection"),
  },
  (table) => [
    check(
      "web_vitals_metric_check",
      sql`((metric = ANY (ARRAY['LCP'::text, 'INP'::text, 'CLS'::text, 'FCP'::text, 'TTFB'::text])))`,
    ),
    check(
      "web_vitals_rating_check",
      sql`((rating = ANY (ARRAY['good'::text, 'needs-improvement'::text, 'poor'::text])))`,
    ),
    index("web_vitals_route_idx").using(
      "btree",
      sql`route`,
      sql`metric`,
      table.recordedAt.desc().nullsFirst(),
    ),
  ],
);
