CREATE TABLE "platform"."role_quota_usage" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"quota_key" text NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_quota_usage_quota_key_check" CHECK (quota_key IN ('analytics_heavy_per_day'))
);

--> statement-breakpoint
CREATE INDEX "role_quota_usage_user_window_idx" ON "platform"."role_quota_usage" USING btree ("user_id","quota_key","consumed_at");
--> statement-breakpoint
CREATE INDEX "role_quota_usage_retention_idx" ON "platform"."role_quota_usage" USING btree ("consumed_at");
--> statement-breakpoint
ALTER TABLE platform.role_quota_usage ADD CONSTRAINT role_quota_usage_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
-- Old API must be stopped during rollout: it does not write the ledger.
LOCK TABLE analytics.analytics_runs IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
-- Preserve accepted work still available at migration time. No FK to the deletable run.
INSERT INTO platform.role_quota_usage(operation_id,user_id,quota_key,consumed_at)
  SELECT id,user_id,'analytics_heavy_per_day',created_at FROM analytics.analytics_runs
  WHERE type IN ('monte_carlo','optimization','stress_test','backtest','goal')
    AND created_at >= now() - interval '168 hours';
--> statement-breakpoint
ALTER TABLE platform.role_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.role_quota_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quota_read ON platform.role_quota_usage FOR SELECT TO oliginvest_app
  USING (user_id = platform.current_user_id());
--> statement-breakpoint
CREATE POLICY quota_insert ON platform.role_quota_usage FOR INSERT TO oliginvest_app
  WITH CHECK (user_id = platform.current_user_id());
--> statement-breakpoint
CREATE POLICY quota_retention ON platform.role_quota_usage FOR DELETE TO oliginvest_app
  USING (user_id = platform.current_user_id() AND consumed_at < now() - interval '168 hours');
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON platform.role_quota_usage TO oliginvest_app;
