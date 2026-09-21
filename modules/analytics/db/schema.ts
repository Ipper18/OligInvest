// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const analyticsAnalyticsRuns = analyticsSchema.table(
  "analytics_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default(sql`'queued'::text`),
    params: jsonb("params").notNull(),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    result: jsonb("result"),
    assumptions: jsonb("assumptions"),
    warnings: jsonb("warnings").notNull().default(sql`'[]'::jsonb`),
    seed: bigint("seed", { mode: "bigint" }),
    algorithmVersion: text("algorithm_version").notNull(),
    dataVersion: jsonb("data_version"),
    progress: smallint("progress").notNull().default(sql`0`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    check("analytics_runs_progress_check", sql`(((progress >= 0) AND (progress <= 100)))`),
    check(
      "analytics_runs_status_check",
      sql`((status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text, 'cancelled'::text])))`,
    ),
    check(
      "analytics_runs_type_check",
      sql`((type = ANY (ARRAY['monte_carlo'::text, 'optimization'::text, 'stress_test'::text, 'what_if'::text, 'backtest'::text, 'goal'::text, 'rebalance'::text])))`,
    ),
    foreignKey({
      name: "analytics_runs_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("analytics_runs_user_idx").using("btree", sql`user_id`, sql`created_at`),
  ],
);

export const analyticsStrategyDefinitions = analyticsSchema.table(
  "strategy_definitions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "strategy_definitions_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    unique("strategy_definitions_user_id_name_key").on(table.userId, table.name),
  ],
);

export const analyticsStressScenarios = analyticsSchema.table(
  "stress_scenarios",
  {
    key: text("key").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    shocks: jsonb("shocks").notNull().default(sql`'{}'::jsonb`),
    description: text("description").notNull(),
    enabled: boolean("enabled").notNull().default(sql`true`),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (_table) => [
    check(
      "stress_scenarios_check",
      sql`(((kind <> 'historical'::text) OR ((start_date IS NOT NULL) AND (end_date IS NOT NULL) AND (start_date < end_date))))`,
    ),
    check(
      "stress_scenarios_kind_check",
      sql`((kind = ANY (ARRAY['historical'::text, 'hypothetical'::text])))`,
    ),
  ],
);
