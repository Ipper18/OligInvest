ALTER TABLE notifications.push_subscriptions ADD COLUMN device_label text;
--> statement-breakpoint
ALTER TABLE notifications.push_subscriptions ADD COLUMN expires_at timestamptz;
