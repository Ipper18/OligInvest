CREATE FUNCTION platform.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION platform.current_app_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(nullif(current_setting('app.role', true), ''), 'anonymous') $$;

CREATE FUNCTION platform.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE VIEW identity.user_directory WITH (security_barrier = true) AS
  SELECT u.id, u.name, u.email, u.role, u.banned, u.two_factor_enabled, u.created_at
  FROM auth.users u
  WHERE platform.current_app_role() IN ('admin', 'system') OR u.id = platform.current_user_id();

-- Zaproszenia: odczyt i zużycie przed zalogowaniem (rejestracja) wyłącznie przez funkcje.
CREATE FUNCTION identity.find_invitation(p_token_hash text)
  RETURNS TABLE (id uuid, email text, role text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    SELECT i.id, i.email, i.role, i.expires_at FROM identity.invitations i
    WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  $$;

CREATE FUNCTION identity.consume_invitation(p_token_hash text, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, identity
  AS $$
    WITH u AS (
      UPDATE identity.invitations SET used_at = now(), used_by = p_user_id
      WHERE token_hash = p_token_hash AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM u)
  $$;
--> statement-breakpoint
-- PostgreSQL column-specific SET NULL actions and platform → identity references.
ALTER TABLE platform.idempotency_keys ADD CONSTRAINT idempotency_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE portfolio.import_rows ADD CONSTRAINT import_rows_transaction_id_user_id_fkey FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (transaction_id);
ALTER TABLE portfolio.journal_entries ADD CONSTRAINT journal_entries_account_id_user_id_fkey FOREIGN KEY (account_id, user_id) REFERENCES portfolio.accounts(id, user_id) ON DELETE SET NULL (account_id);
ALTER TABLE portfolio.journal_entries ADD CONSTRAINT journal_entries_transaction_id_user_id_fkey FOREIGN KEY (transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (transaction_id);
ALTER TABLE portfolio.transactions ADD CONSTRAINT transactions_import_batch_id_user_id_fkey FOREIGN KEY (import_batch_id, user_id) REFERENCES portfolio.import_batches(id, user_id) ON DELETE SET NULL (import_batch_id);
ALTER TABLE portfolio.transactions ADD CONSTRAINT transactions_related_transaction_id_user_id_fkey FOREIGN KEY (related_transaction_id, user_id) REFERENCES portfolio.transactions(id, user_id) ON DELETE SET NULL (related_transaction_id);
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'updated_at'
      AND c.table_schema IN ('auth', 'identity', 'platform', 'notifications', 'market', 'portfolio', 'analytics', 'alerts', 'education')
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at()',
                   r.table_schema, r.table_name);
  END LOOP;
END
$$;
--> statement-breakpoint
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
--> statement-breakpoint
GRANT USAGE ON SCHEMA identity, platform, notifications, market, portfolio, analytics, alerts, education TO oliginvest_app;
GRANT USAGE ON SCHEMA auth TO oliginvest_auth;
GRANT USAGE ON SCHEMA identity TO oliginvest_auth;
GRANT USAGE ON SCHEMA market TO oliginvest_analytics_ro;

-- oliginvest_auth: wyłącznie tabele uwierzytelniania + funkcje zaproszeń
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO oliginvest_auth;
GRANT EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) TO oliginvest_auth;

-- oliginvest_app: tabele domenowe (RLS egzekwuje własność); BRAK dostępu do schematu auth
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, notifications, market, portfolio, analytics, alerts, education TO oliginvest_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.feature_flags, platform.role_limits, platform.idempotency_keys, platform.web_vitals TO oliginvest_app;
GRANT SELECT, INSERT ON platform.audit_log TO oliginvest_app;                         -- append-only
REVOKE UPDATE, DELETE, TRUNCATE ON identity.consent_events FROM oliginvest_app;       -- append-only (po GRANT ON ALL TABLES)
GRANT SELECT, INSERT, DELETE ON platform.erasure_log TO oliginvest_app;                -- DELETE: czyszczenie po purge_after
GRANT SELECT ON identity.user_directory TO oliginvest_app;
-- Widok jest automatycznie aktualizowalny i działa z uprawnieniami właściciela — bez tego REVOKE rola aplikacji
-- mogłaby zmienić auth.users (np. własną rolę) przez UPDATE na widoku.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON identity.user_directory FROM oliginvest_app;
GRANT EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) TO oliginvest_app;
GRANT EXECUTE ON FUNCTION platform.current_user_id(), platform.current_app_role() TO oliginvest_app;

-- oliginvest_analytics_ro: tylko dane rynkowe (bez watchlist i presetów użytkowników)
GRANT SELECT ON market.instruments, market.bars_daily, market.fx_rates, market.corporate_actions, market.trading_calendar,
                market.sectors, market.sector_memberships, market.universes, market.universe_members,
                market.macro_series, market.macro_observations TO oliginvest_analytics_ro;

-- Funkcje: domyślnie wykonywalne przez PUBLIC — zawężamy funkcje SECURITY DEFINER
REVOKE EXECUTE ON FUNCTION identity.find_invitation(text), identity.consume_invitation(text, uuid) FROM PUBLIC;

-- Przyszłe tabele w schematach domenowych dostają uprawnienia domyślne (nowa tabela z user_id MUSI dostać politykę RLS w tej samej migracji).
ALTER DEFAULT PRIVILEGES FOR ROLE oliginvest_owner IN SCHEMA identity, notifications, market, portfolio, analytics, alerts, education
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO oliginvest_app;
--> statement-breakpoint
COMMENT ON SCHEMA auth IS 'Better Auth — dostęp wyłącznie dla roli oliginvest_auth (ADR-004)';
COMMENT ON TABLE portfolio.transactions IS 'Źródło prawdy portfela: operacje (obliczenia-finansowe.md § 1)';
COMMENT ON TABLE portfolio.lots IS 'Pochodne: partie FIFO odtwarzane z operacji (zadanie recompute)';
COMMENT ON TABLE portfolio.valuations_daily IS 'Pochodne: dzienne wyceny rachunków — wejście TWR/XIRR';
COMMENT ON TABLE market.bars_daily IS 'Historia EOD; źródło prawdy dla wykresów i analiz (strategia-cache.md)';
COMMENT ON TABLE platform.audit_log IS 'Append-only: rola aplikacji ma tylko INSERT i SELECT';
COMMENT ON TABLE identity.consent_events IS 'Append-only: akceptacje regulaminu, potwierdzenia informacji o przetwarzaniu i zgody (FR-07.12)';
COMMENT ON TABLE platform.erasure_log IS 'UUID usuniętych kont do ponownego usunięcia po odtworzeniu kopii zapasowej (RODO art. 17)';
COMMENT ON VIEW identity.user_directory IS 'Bezpieczne kolumny kont; filtr: admin/system widzi wszystkich, użytkownik siebie';
