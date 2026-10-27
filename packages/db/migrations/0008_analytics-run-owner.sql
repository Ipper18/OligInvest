-- BL-312 (owner decision 2026-10-20): the run owner lives in analytics_runs.user_id. jobs receives
-- only runId from the analytics-results queue, so it reads the owner through this narrow
-- function (system context only) and then writes the result under the owner's RLS context.
CREATE FUNCTION analytics.run_owner(p_run_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, analytics
  AS $$
    SELECT r.user_id FROM analytics.analytics_runs r
    WHERE r.id = p_run_id AND platform.current_app_role() = 'system'
  $$;
--> statement-breakpoint
CREATE POLICY definer_functions ON analytics.analytics_runs FOR SELECT TO oliginvest_owner USING (true);
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION analytics.run_owner(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION analytics.run_owner(uuid) TO oliginvest_app;
