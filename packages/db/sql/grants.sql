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
