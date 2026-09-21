-- 12.1 Tabele z danymi użytkownika: właściciel = platform.current_user_id(). Admin NIE ma polityk (FR-08.01).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'identity.user_preferences', 'identity.deletion_requests', 'identity.data_exports',
    'platform.idempotency_keys',
    'notifications.push_subscriptions', 'notifications.notification_preferences', 'notifications.notification_deliveries',
    'market.watchlists', 'market.watchlist_items', 'market.screener_presets',
    'portfolio.accounts', 'portfolio.import_batches', 'portfolio.import_files', 'portfolio.import_templates',
    'portfolio.transactions', 'portfolio.import_rows', 'portfolio.instrument_overrides', 'portfolio.lots',
    'portfolio.lot_consumptions', 'portfolio.positions_daily', 'portfolio.cash_balances_daily',
    'portfolio.valuations_daily', 'portfolio.journal_entries', 'portfolio.journal_postmortems',
    'portfolio.target_allocations',
    'analytics.analytics_runs', 'analytics.strategy_definitions',
    'alerts.alert_rules', 'alerts.alert_events',
    'education.onboarding_state', 'education.learning_progress']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY owner_all ON %s FOR ALL TO oliginvest_app
                     USING (user_id = platform.current_user_id())
                     WITH CHECK (user_id = platform.current_user_id())$p$, t);
  END LOOP;
END
$$;

-- 12.2 Tabele konfiguracyjne: odczyt dla wszystkich, zapis tylko admin/system (obrona w głąb obok RBAC w api).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform.feature_flags', 'platform.role_limits', 'analytics.stress_scenarios']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY read_all ON %s FOR SELECT TO oliginvest_app USING (true)', t);
    EXECUTE format($p$CREATE POLICY write_admin ON %s FOR ALL TO oliginvest_app
                     USING (platform.current_app_role() IN ('admin', 'system'))
                     WITH CHECK (platform.current_app_role() IN ('admin', 'system'))$p$, t);
  END LOOP;
END
$$;

-- 12.3 Zaproszenia: tylko admin (rejestracja korzysta z funkcji SECURITY DEFINER).
ALTER TABLE identity.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON identity.invitations FOR ALL TO oliginvest_app
  USING (platform.current_app_role() = 'admin') WITH CHECK (platform.current_app_role() = 'admin');
-- Funkcje SECURITY DEFINER działają jako właściciel; przy FORCE RLS właściciel bez polityki nie widzi wierszy.
-- Rola oliginvest_owner jest używana wyłącznie przez migracje i te funkcje (zasada dla każdej nowej funkcji DEFINER).
CREATE POLICY definer_functions ON identity.invitations FOR ALL TO oliginvest_owner USING (true) WITH CHECK (true);

-- 12.4 Audyt: dopisywanie przez każdego, odczyt — admin lub własne wpisy; brak UPDATE/DELETE (brak uprawnień).
ALTER TABLE platform.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON platform.audit_log FOR INSERT TO oliginvest_app WITH CHECK (true);
CREATE POLICY audit_read ON platform.audit_log FOR SELECT TO oliginvest_app
  USING (platform.current_app_role() = 'admin' OR actor_user_id = platform.current_user_id());

-- 12.5 Zgody i akceptacje: właściciel dopisuje i czyta własne zdarzenia; brak UPDATE/DELETE (brak uprawnień — § 13).
--      Usunięcie konta kasuje zdarzenia kaskadowo (akcje referencyjne nie podlegają RLS).
ALTER TABLE identity.consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.consent_events FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_select_own ON identity.consent_events FOR SELECT TO oliginvest_app
  USING (user_id = platform.current_user_id());
CREATE POLICY consent_insert_own ON identity.consent_events FOR INSERT TO oliginvest_app
  WITH CHECK (user_id = platform.current_user_id());

-- 12.6 Dziennik usuniętych kont: wyłącznie kontekst systemowy (zadanie usuwania kont i zadanie po odtworzeniu kopii).
ALTER TABLE platform.erasure_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.erasure_log FORCE ROW LEVEL SECURITY;
CREATE POLICY system_all ON platform.erasure_log FOR ALL TO oliginvest_app
  USING (platform.current_app_role() = 'system') WITH CHECK (platform.current_app_role() = 'system');
