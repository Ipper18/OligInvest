// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const educationSchema = pgSchema("education");

export const educationLearningProgress = educationSchema.table(
  "learning_progress",
  {
    userId: uuid("user_id").notNull(),
    lessonKey: text("lesson_key").notNull(),
    status: text("status").notNull(),
    score: smallint("score"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ name: "learning_progress_pkey", columns: [table.userId, table.lessonKey] }),
    check(
      "learning_progress_status_check",
      sql`((status = ANY (ARRAY['started'::text, 'completed'::text])))`,
    ),
    foreignKey({
      name: "learning_progress_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const educationOnboardingState = educationSchema.table(
  "onboarding_state",
  {
    userId: uuid("user_id").primaryKey(),
    step: text("step").notNull().default(sql`'start'::text`),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    skippedAt: timestamp("skipped_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "onboarding_state_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);
