// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { marketInstruments } from "@oliginvest/mod-market/server";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const alertsSchema = pgSchema("alerts");

export const alertsAlertEvents = alertsSchema.table(
  "alert_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    ruleId: uuid("rule_id").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    value: numeric("value", { precision: 20, scale: 8 }),
    threshold: numeric("threshold", { precision: 20, scale: 8 }),
    dataAsOf: timestamp("data_as_of", { withTimezone: true, mode: "string" }).notNull(),
    dataSource: text("data_source").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    foreignKey({
      name: "alert_events_rule_id_user_id_fkey",
      columns: [table.ruleId, table.userId],
      foreignColumns: [alertsAlertRules.id, alertsAlertRules.userId],
    }).onDelete("cascade"),
    index("alert_events_user_idx").using("btree", sql`user_id`, sql`triggered_at`),
  ],
);

export const alertsAlertRules = alertsSchema.table(
  "alert_rules",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    instrumentId: uuid("instrument_id"),
    params: jsonb("params").notNull(),
    channels: text("channels").array().notNull().default(sql`'{push,email}'::text[]`),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(sql`1440`),
    hysteresisPct: numeric("hysteresis_pct", { precision: 6, scale: 3 })
      .notNull()
      .default(sql`0.5`),
    enabled: boolean("enabled").notNull().default(sql`true`),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true, mode: "string" }),
    lastState: jsonb("last_state"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("alert_rules_id_user_id_key").on(table.id, table.userId),
    foreignKey({
      name: "alert_rules_instrument_id_fkey",
      columns: [table.instrumentId],
      foreignColumns: [marketInstruments.id],
    }).onDelete("cascade"),
    check(
      "alert_rules_type_check",
      sql`((type = ANY (ARRAY['price_above'::text, 'price_below'::text, 'change_pct'::text, 'indicator'::text, 'portfolio_change'::text, 'drawdown'::text, 'allocation_drift'::text, 'earnings'::text, 'news'::text])))`,
    ),
    foreignKey({
      name: "alert_rules_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("alert_rules_instrument_idx").using("btree", sql`instrument_id`).where(sql`enabled`),
  ],
);
