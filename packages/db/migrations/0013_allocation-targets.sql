ALTER TABLE portfolio.target_allocations ALTER COLUMN tolerance_pp TYPE numeric(11,8);
--> statement-breakpoint
CREATE FUNCTION alerts.disable_target_alerts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE alerts.alert_rules
     SET enabled = false,
         last_state = coalesce(last_state, '{}'::jsonb) || jsonb_build_object(
           'inactiveReason', CASE WHEN TG_OP = 'DELETE' THEN 'target_deleted' ELSE 'target_changed' END),
         updated_at = now()
   WHERE user_id = OLD.user_id AND type = 'allocation_drift' AND params->>'targetId' = OLD.id::text;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER disable_target_alerts AFTER UPDATE OR DELETE ON portfolio.target_allocations
FOR EACH ROW EXECUTE FUNCTION alerts.disable_target_alerts();
