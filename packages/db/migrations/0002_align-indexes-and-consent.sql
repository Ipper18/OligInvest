ALTER TABLE "identity"."consent_events" DROP CONSTRAINT "consent_events_version_check";--> statement-breakpoint
DROP INDEX "platform"."audit_log_actor_idx";--> statement-breakpoint
DROP INDEX "platform"."audit_log_occurred_at_idx";--> statement-breakpoint
DROP INDEX "platform"."web_vitals_route_idx";--> statement-breakpoint
DROP INDEX "alerts"."alert_events_user_idx";--> statement-breakpoint
DROP INDEX "analytics"."analytics_runs_user_idx";--> statement-breakpoint
DROP INDEX "identity"."consent_events_user_doc_idx";--> statement-breakpoint
DROP INDEX "market"."news_items_instrument_idx";--> statement-breakpoint
DROP INDEX "notifications"."notification_deliveries_user_idx";--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "platform"."audit_log" USING btree (actor_user_id,"occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "platform"."audit_log" USING btree ("occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "web_vitals_route_idx" ON "platform"."web_vitals" USING btree (route,metric,"recorded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "alert_events_user_idx" ON "alerts"."alert_events" USING btree (user_id,"triggered_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "analytics_runs_user_idx" ON "analytics"."analytics_runs" USING btree (user_id,"created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "consent_events_user_doc_idx" ON "identity"."consent_events" USING btree (user_id,document,"recorded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "news_items_instrument_idx" ON "market"."news_items" USING btree (instrument_id,"published_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_idx" ON "notifications"."notification_deliveries" USING btree (user_id,"created_at" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "identity"."consent_events" ADD CONSTRAINT "consent_events_version_check" CHECK (((version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?(\.[0-9]{1,3})?$'::text)));