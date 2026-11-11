-- BL-115 (NFR-11.02): the system context may read and delete only unused invitations
-- 30 days after expiry; every other invitation stays admin-only.
CREATE POLICY retention_read ON identity.invitations FOR SELECT TO oliginvest_app
  USING (platform.current_app_role() = 'system' AND used_at IS NULL AND expires_at < now() - interval '30 days');
--> statement-breakpoint
CREATE POLICY retention_delete ON identity.invitations FOR DELETE TO oliginvest_app
  USING (platform.current_app_role() = 'system' AND used_at IS NULL AND expires_at < now() - interval '30 days');
