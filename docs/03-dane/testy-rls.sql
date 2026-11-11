-- Scenariusze testowe RLS i uprawnień dla schema.sql (PostgreSQL 18).
-- Cel: specyfikacja testów integracyjnych izolacji danych (NFR-03.04, NFR-03.13, FR-07.09, FR-07.12, FR-08.01, FR-08.05); w M1 przenieść do
-- testów packages/db (Vitest + prawdziwy PostgreSQL) i uruchamiać w CI przy każdej migracji.
-- Zweryfikowano 2026-09-19 na PostgreSQL 18.4: wszystkie scenariusze przechodzą. Uruchamiać jako superuser po schema.sql.
\set ON_ERROR_STOP on
\echo '== seed users (as oliginvest_auth) =='
SET ROLE oliginvest_auth;
INSERT INTO auth.users (id, name, email) VALUES
  ('0198a000-0000-7000-8000-00000000000a', 'User A', 'a@example.test'),
  ('0198a000-0000-7000-8000-00000000000b', 'User B', 'b@example.test'),
  ('0198a000-0000-7000-8000-0000000000ad', 'Admin', 'admin@example.test');
UPDATE auth.users SET role = 'admin' WHERE email = 'admin@example.test';
INSERT INTO auth.accounts (account_id, provider_id, user_id, password)
  VALUES ('a@example.test', 'credential', '0198a000-0000-7000-8000-00000000000a', '$argon2id$v=19$m=19456,t=2,p=1$synthetic');
RESET ROLE;

\echo '== seed market data (as app, system) =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.role = 'system';
INSERT INTO market.instruments (id, isin, mic, ticker, name, type, currency)
  VALUES ('0198a000-0000-7000-8000-0000000000c1', 'PLPKO0000016', 'XWAR', 'PKO', 'PKO BP', 'stock', 'PLN');
INSERT INTO market.bars_daily (instrument_id, session_date, open, high, low, close, volume, source)
  VALUES ('0198a000-0000-7000-8000-0000000000c1', '2026-09-16', 119.5, 120.84, 119.34, 120.42, 2983158, 'gpw');
COMMIT;

\echo '== user A creates account + transaction =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000a'; SET LOCAL app.role = 'user';
INSERT INTO portfolio.accounts (id, user_id, name, broker, currency)
  VALUES ('0198a000-0000-7000-8000-0000000000f1', '0198a000-0000-7000-8000-00000000000a', 'XTB', 'xtb', 'PLN');
INSERT INTO portfolio.transactions (user_id, account_id, type, trade_date, instrument_id, quantity, price, price_currency, amount, cash_currency, source)
  VALUES ('0198a000-0000-7000-8000-00000000000a', '0198a000-0000-7000-8000-0000000000f1', 'BUY', '2026-09-16',
          '0198a000-0000-7000-8000-0000000000c1', 10, 120.42, 'PLN', -1204.20, 'PLN', 'manual');
COMMIT;

\echo '== user B sees nothing of A, even without WHERE =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
SELECT count(*) AS b_sees_accounts FROM portfolio.accounts;
SELECT count(*) AS b_sees_transactions FROM portfolio.transactions;
DO $$ BEGIN
  IF (SELECT count(*) FROM portfolio.transactions) <> 0 THEN RAISE EXCEPTION 'RLS LEAK: B sees A transactions'; END IF;
END $$;
COMMIT;

\echo '== user B cannot insert a row claiming user A (WITH CHECK) =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b';
DO $$ BEGIN
  BEGIN
    INSERT INTO portfolio.accounts (user_id, name, broker, currency) VALUES ('0198a000-0000-7000-8000-00000000000a', 'hack', 'xtb', 'PLN');
    RAISE EXCEPTION 'RLS WITH CHECK FAILED';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: WITH CHECK blocked cross-user insert';
  END;
END $$;
COMMIT;

\echo '== user B cannot attach own transaction to A account (composite FK) =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b';
INSERT INTO portfolio.accounts (id, user_id, name, broker, currency)
  VALUES ('0198a000-0000-7000-8000-0000000000f2', '0198a000-0000-7000-8000-00000000000b', 'mBank', 'mbank', 'PLN');
DO $$ BEGIN
  BEGIN
    INSERT INTO portfolio.transactions (user_id, account_id, type, trade_date, amount, cash_currency, source)
      VALUES ('0198a000-0000-7000-8000-00000000000b', '0198a000-0000-7000-8000-0000000000f1', 'DEPOSIT', '2026-09-16', 100, 'PLN', 'manual');
    RAISE EXCEPTION 'COMPOSITE FK FAILED';
  EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'OK: composite FK blocked cross-user reference';
  END;
END $$;
COMMIT;

\echo '== no context => no rows =='
BEGIN;
DO $$ BEGIN IF (SELECT count(*) FROM portfolio.accounts) <> 0 THEN RAISE EXCEPTION 'RLS LEAK without context'; END IF; END $$;
COMMIT;

\echo '== admin role cannot read other users portfolio =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-0000000000ad'; SET LOCAL app.role = 'admin';
DO $$ BEGIN IF (SELECT count(*) FROM portfolio.transactions) <> 0 THEN RAISE EXCEPTION 'ADMIN SEES PORTFOLIO'; END IF; END $$;
SELECT count(*) AS admin_sees_directory FROM identity.user_directory;
COMMIT;

\echo '== user sees only self in user_directory; cannot update via view =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
DO $$ BEGIN IF (SELECT count(*) FROM identity.user_directory) <> 1 THEN RAISE EXCEPTION 'DIRECTORY LEAK'; END IF; END $$;
DO $$ BEGIN
  BEGIN
    UPDATE identity.user_directory SET role = 'admin' WHERE id = '0198a000-0000-7000-8000-00000000000b';
    RAISE EXCEPTION 'VIEW UPDATE ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: view is read-only for app';
  END;
END $$;
COMMIT;

\echo '== app cannot read auth tables (password hashes, 2FA secrets) =='
DO $$ BEGIN
  BEGIN PERFORM 1 FROM auth.accounts; RAISE EXCEPTION 'APP READS auth.accounts';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: app has no access to auth schema';
  END;
  BEGIN UPDATE auth.sessions SET mfa_method = 'totp'; RAISE EXCEPTION 'APP CAN FORGE MFA METHOD';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: app cannot forge MFA method';
  END;
END $$;

\echo '== audit log is append-only =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000a'; SET LOCAL app.role = 'user';
INSERT INTO platform.audit_log (actor_user_id, actor_ref, actor_type, action) VALUES ('0198a000-0000-7000-8000-00000000000a', 'ref-a', 'user', 'test.action');
DO $$ BEGIN
  BEGIN UPDATE platform.audit_log SET action = 'tampered'; RAISE EXCEPTION 'AUDIT UPDATE ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: audit UPDATE denied';
  END;
END $$;
COMMIT;

\echo '== config tables: user cannot write, admin can =='
BEGIN; SET LOCAL app.role = 'user';
DO $$ BEGIN
  BEGIN INSERT INTO platform.feature_flags (key, description) VALUES ('module.test', 'x'); RAISE EXCEPTION 'USER WROTE FLAG';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: user cannot write flags';
  END;
END $$;
COMMIT;
BEGIN; SET LOCAL app.role = 'admin';
INSERT INTO platform.feature_flags (key, description, enabled) VALUES ('module.test', 'x', true);
COMMIT;
RESET ROLE;

\echo '== analytics_ro: market yes, portfolio/watchlists no =='
SET ROLE oliginvest_analytics_ro;
SELECT count(*) AS analytics_sees_bars FROM market.bars_daily;
-- R-38: the worker reads the § 14 gate itself; data-quality findings stay read-only for it.
SELECT count(*) AS analytics_sees_quality_issues FROM market.data_quality_issues;
DO $$ BEGIN
  BEGIN UPDATE market.data_quality_issues SET status = 'resolved'; RAISE EXCEPTION 'ANALYTICS RESOLVES QUALITY ISSUES';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: analytics cannot change quality issues';
  END;
  BEGIN PERFORM 1 FROM portfolio.transactions; RAISE EXCEPTION 'ANALYTICS READS PORTFOLIO';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: analytics has no access to portfolio';
  END;
  BEGIN PERFORM 1 FROM market.watchlists; RAISE EXCEPTION 'ANALYTICS READS WATCHLISTS';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: analytics has no access to user watchlists';
  END;
END $$;
RESET ROLE;

\echo '== invitation functions (auth role) =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.role = 'admin';
INSERT INTO identity.invitations (email, role, token_hash, invited_by, expires_at)
  VALUES ('new@example.test', 'user', 'hash-123', '0198a000-0000-7000-8000-0000000000ad', now() + interval '72 hours');
COMMIT;
RESET ROLE;
SET ROLE oliginvest_auth;
SELECT email, role FROM identity.find_invitation($$hash-123$$);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM identity.find_invitation($x$hash-123$x$)) THEN RAISE EXCEPTION $e$INVITATION NOT FOUND$e$; END IF; END $$;
SELECT identity.consume_invitation('hash-123', '0198a000-0000-7000-8000-00000000000b') AS consumed_first;
SELECT identity.consume_invitation('hash-123', '0198a000-0000-7000-8000-00000000000b') AS consumed_second_should_be_false;
RESET ROLE;

\echo '== invitation retention: system sees and deletes only unused invitations 30 days after expiry (BL-115) =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-0000000000ad'; SET LOCAL app.role = 'admin';
INSERT INTO identity.invitations (email, role, token_hash, invited_by, expires_at, used_at, used_by, revoked_at) VALUES
  ('stale@example.test', 'user', 'retention-stale', '0198a000-0000-7000-8000-0000000000ad', now() - interval '30 days 1 minute', NULL, NULL, NULL),
  ('revoked@example.test', 'user', 'retention-revoked', '0198a000-0000-7000-8000-0000000000ad', now() - interval '31 days', NULL, NULL, now() - interval '40 days'),
  ('recent@example.test', 'user', 'retention-recent', '0198a000-0000-7000-8000-0000000000ad', now() - interval '29 days 23 hours', NULL, NULL, NULL),
  ('used@example.test', 'user', 'retention-used', '0198a000-0000-7000-8000-0000000000ad', now() - interval '60 days', now() - interval '61 days', '0198a000-0000-7000-8000-00000000000b', NULL);
COMMIT;
BEGIN; SET LOCAL app.user_id = ''; SET LOCAL app.role = 'system';
DO $$ BEGIN
  IF (SELECT count(*) FROM identity.invitations) <> 2 THEN RAISE EXCEPTION 'INVITATION RETENTION READ SCOPE'; END IF;
  UPDATE identity.invitations SET used_at = now();
  IF FOUND THEN RAISE EXCEPTION 'SYSTEM UPDATES INVITATIONS'; END IF;
  BEGIN
    INSERT INTO identity.invitations (email, role, token_hash, invited_by, expires_at)
      VALUES ('system@example.test', 'admin', 'retention-system', '0198a000-0000-7000-8000-0000000000ad', now());
    RAISE EXCEPTION 'SYSTEM CREATES INVITATIONS';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: system cannot create invitations'; END;
  DELETE FROM identity.invitations;
  IF EXISTS (SELECT 1 FROM identity.invitations) THEN RAISE EXCEPTION 'INVITATION RETENTION DELETE'; END IF;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
DO $$ BEGIN
  DELETE FROM identity.invitations;
  IF FOUND THEN RAISE EXCEPTION 'USER DELETES INVITATIONS'; END IF;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-0000000000ad'; SET LOCAL app.role = 'admin';
DO $$ BEGIN
  IF (SELECT array_agg(token_hash ORDER BY token_hash) FROM identity.invitations WHERE token_hash LIKE 'retention-%')
     IS DISTINCT FROM ARRAY['retention-recent', 'retention-used'] THEN RAISE EXCEPTION 'INVITATION RETENTION BOUNDARY'; END IF;
  RAISE NOTICE 'OK: invitation retention boundary, used invitations kept';
END $$;
DELETE FROM identity.invitations WHERE token_hash LIKE 'retention-%';
COMMIT;
RESET ROLE;

\echo '== consent events: own rows only, append-only, action matches document =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000a'; SET LOCAL app.role = 'user';
INSERT INTO identity.consent_events (user_id, document, version, action, source) VALUES
  ('0198a000-0000-7000-8000-00000000000a', 'terms', '2026-09', 'accepted', 'sign_up'),
  ('0198a000-0000-7000-8000-00000000000a', 'privacy_notice', '2026-09', 'acknowledged', 'sign_up'),
  ('0198a000-0000-7000-8000-00000000000a', 'diagnostics', '2026-09', 'granted', 'sign_up');
DO $$ BEGIN
  BEGIN UPDATE identity.consent_events SET action = 'withdrawn'; RAISE EXCEPTION 'CONSENT UPDATE ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: consent events are append-only';
  END;
  BEGIN
    INSERT INTO identity.consent_events (user_id, document, version, action, source)
      VALUES ('0198a000-0000-7000-8000-00000000000b', 'terms', '2026-09', 'accepted', 'settings');
    RAISE EXCEPTION 'CONSENT CROSS-USER INSERT';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: cannot record consent for another user';
  END;
  BEGIN
    INSERT INTO identity.consent_events (user_id, document, version, action, source)
      VALUES ('0198a000-0000-7000-8000-00000000000a', 'terms', '2026-09', 'granted', 'settings');
    RAISE EXCEPTION 'CONSENT ACTION CHECK FAILED';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK: action must match document';
  END;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
DO $$ BEGIN IF (SELECT count(*) FROM identity.consent_events) <> 0 THEN RAISE EXCEPTION 'CONSENT LEAK: B sees A'; END IF; END $$;
COMMIT;

\echo '== erasure log: system context only =='
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000a'; SET LOCAL app.role = 'user';
DO $$ BEGIN
  BEGIN
    INSERT INTO platform.erasure_log (erased_user_id, purge_after) VALUES ('0198a000-0000-7000-8000-0000000000ee', now() + interval '90 days');
    RAISE EXCEPTION 'USER WROTE ERASURE LOG';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: user cannot write erasure log';
  END;
END $$;
COMMIT;
BEGIN; SET LOCAL app.role = 'system';
INSERT INTO platform.erasure_log (erased_user_id, purge_after) VALUES ('0198a000-0000-7000-8000-0000000000ee', now() + interval '90 days');
DO $$ BEGIN IF (SELECT count(*) FROM platform.erasure_log) <> 1 THEN RAISE EXCEPTION 'SYSTEM CANNOT SEE ERASURE LOG'; END IF; END $$;
COMMIT;
RESET ROLE;

\echo '== role quota ledger: owner isolation, append-only and retention boundary =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000a'; SET LOCAL app.role = 'pro';
INSERT INTO platform.role_quota_usage(operation_id, user_id, quota_key, consumed_at) VALUES
  ('0198a000-0000-7000-8000-0000000000e1', '0198a000-0000-7000-8000-00000000000a', 'analytics_heavy_per_day', now()),
  ('0198a000-0000-7000-8000-0000000000e2', '0198a000-0000-7000-8000-00000000000a', 'analytics_heavy_per_day', now() - interval '168 hours'),
  ('0198a000-0000-7000-8000-0000000000e3', '0198a000-0000-7000-8000-00000000000a', 'analytics_heavy_per_day', now() - interval '168 hours 1 second');
DO $$ BEGIN
  BEGIN
    INSERT INTO platform.role_quota_usage VALUES (uuidv7(), '0198a000-0000-7000-8000-00000000000b', 'analytics_heavy_per_day', now());
    RAISE EXCEPTION 'QUOTA CROSS-USER INSERT';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: quota insert owner only'; END;
  BEGIN
    UPDATE platform.role_quota_usage SET consumed_at = now() - interval '8 days';
    RAISE EXCEPTION 'QUOTA UPDATE ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'OK: quota cannot be changed'; END;
  DELETE FROM platform.role_quota_usage;
  IF (SELECT count(*) FROM platform.role_quota_usage) <> 2 THEN RAISE EXCEPTION 'QUOTA RETENTION BOUNDARY'; END IF;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM platform.role_quota_usage) THEN RAISE EXCEPTION 'QUOTA OWNER LEAK'; END IF;
  DELETE FROM platform.role_quota_usage;
  IF FOUND THEN RAISE EXCEPTION 'QUOTA FOREIGN DELETE'; END IF;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-0000000000ad'; SET LOCAL app.role = 'admin';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM platform.role_quota_usage) THEN RAISE EXCEPTION 'QUOTA ADMIN LEAK'; END IF; END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = ''; SET LOCAL app.role = 'system';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM platform.role_quota_usage) THEN RAISE EXCEPTION 'QUOTA SYSTEM LEAK'; END IF; END $$;
COMMIT;
RESET ROLE;

\echo '== account deletion cascades through FORCE RLS tables (auth role) =='
SET ROLE oliginvest_auth;
DELETE FROM auth.users WHERE id = '0198a000-0000-7000-8000-00000000000a';
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM platform.role_quota_usage WHERE user_id = '0198a000-0000-7000-8000-00000000000a')
     OR EXISTS (SELECT 1 FROM identity.consent_events WHERE user_id = '0198a000-0000-7000-8000-00000000000a')
     OR EXISTS (SELECT 1 FROM portfolio.transactions WHERE user_id = '0198a000-0000-7000-8000-00000000000a')
  THEN RAISE EXCEPTION 'ACCOUNT DELETION DID NOT CASCADE'; END IF;
  RAISE NOTICE 'OK: account deletion removed consent events and portfolio rows';
END $$;

\echo '== analytics.run_owner: system context only, owner never exposed to users (BL-312) =='
SET ROLE oliginvest_app;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000b'; SET LOCAL app.role = 'user';
INSERT INTO analytics.analytics_runs (id, user_id, type, params, input_snapshot, algorithm_version)
  VALUES ('0198a000-0000-7000-8000-0000000000f1', '0198a000-0000-7000-8000-00000000000b', 'monte_carlo', '{}', '{}', 'test');
COMMIT;
BEGIN; SET LOCAL app.role = 'system';
DO $$ BEGIN
  IF analytics.run_owner('0198a000-0000-7000-8000-0000000000f1') IS DISTINCT FROM '0198a000-0000-7000-8000-00000000000b'
  THEN RAISE EXCEPTION 'RUN OWNER NOT FOUND IN SYSTEM CONTEXT'; END IF;
  IF EXISTS (SELECT 1 FROM analytics.analytics_runs) THEN RAISE EXCEPTION 'SYSTEM CONTEXT SEES RUNS'; END IF;
END $$;
COMMIT;
BEGIN; SET LOCAL app.user_id = '0198a000-0000-7000-8000-00000000000c'; SET LOCAL app.role = 'user';
DO $$ BEGIN
  IF analytics.run_owner('0198a000-0000-7000-8000-0000000000f1') IS NOT NULL THEN RAISE EXCEPTION 'RUN OWNER LEAKS TO USERS'; END IF;
  UPDATE analytics.analytics_runs SET status = 'done' WHERE id = '0198a000-0000-7000-8000-0000000000f1';
  IF FOUND THEN RAISE EXCEPTION 'FOREIGN RUN UPDATED'; END IF;
END $$;
COMMIT;
RESET ROLE;

\echo '== uuidv7 default works =='
SELECT uuid_extract_version(id) AS uuid_version FROM portfolio.accounts LIMIT 1;
\echo 'ALL RLS SMOKE TESTS PASSED'
