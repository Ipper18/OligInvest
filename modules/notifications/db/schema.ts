// Table contract: docs/03-dane/schema.sql. Custom PostgreSQL objects live in packages/db/sql.

import { authUsers } from "@oliginvest/mod-identity/server";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const notificationsSchema = pgSchema("notifications");

export const notificationsNotificationDeliveries = notificationsSchema.table(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    kind: text("kind").notNull(),
    sourceRef: text("source_ref"),
    channel: text("channel").notNull(),
    status: text("status").notNull().default(sql`'queued'::text`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    check(
      "notification_deliveries_channel_check",
      sql`((channel = ANY (ARRAY['push'::text, 'email'::text])))`,
    ),
    check(
      "notification_deliveries_kind_check",
      sql`((kind = ANY (ARRAY['alert'::text, 'system'::text, 'export'::text, 'invitation'::text, 'security'::text])))`,
    ),
    check(
      "notification_deliveries_status_check",
      sql`((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))`,
    ),
    foreignKey({
      name: "notification_deliveries_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("notification_deliveries_user_idx").using("btree", sql`user_id`, sql`created_at`),
  ],
);

export const notificationsNotificationPreferences = notificationsSchema.table(
  "notification_preferences",
  {
    userId: uuid("user_id").primaryKey(),
    channels: jsonb("channels").notNull().default(sql`'{"push": true, "email": true}'::jsonb`),
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    emailFallback: boolean("email_fallback").notNull().default(sql`true`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "notification_preferences_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
  ],
);

export const notificationsPushSubscriptions = notificationsSchema.table(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .default(sql`now()`),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: "string" }),
    failureCount: integer("failure_count").notNull().default(sql`0`),
  },
  (table) => [
    unique("push_subscriptions_endpoint_key").on(table.endpoint),
    foreignKey({
      name: "push_subscriptions_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }).onDelete("cascade"),
    index("push_subscriptions_user_idx").using("btree", sql`user_id`),
  ],
);
