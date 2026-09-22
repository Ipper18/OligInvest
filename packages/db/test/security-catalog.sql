-- Inspect every role/table, beyond the behavioral scenarios in testy-rls.sql.
DO $$
DECLARE
  role_name text;
  other_role text;
  table_row record;
  function_row record;
  expected_market_tables text[] := ARRAY[
    'instruments', 'bars_daily', 'fx_rates', 'corporate_actions', 'trading_calendar',
    'sectors', 'sector_memberships', 'universes', 'universe_members', 'macro_series', 'macro_observations'
  ];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['oliginvest_owner', 'oliginvest_auth', 'oliginvest_app', 'oliginvest_analytics_ro', 'oliginvest_backup'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = role_name AND rolcanlogin
        AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        AND rolbypassrls = (role_name = 'oliginvest_backup')
    ) THEN RAISE EXCEPTION 'Unsafe or missing role: %', role_name; END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['oliginvest_auth', 'oliginvest_app', 'oliginvest_analytics_ro'] LOOP
    FOREACH other_role IN ARRAY ARRAY['oliginvest_owner', 'oliginvest_auth', 'oliginvest_app', 'oliginvest_analytics_ro', 'oliginvest_backup', 'pg_read_all_data', 'pg_write_all_data'] LOOP
      IF role_name <> other_role AND pg_has_role(role_name, other_role, 'MEMBER') THEN
        RAISE EXCEPTION 'Unexpected role membership: % -> %', role_name, other_role;
      END IF;
    END LOOP;
    IF has_schema_privilege(role_name, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'Runtime role can create public objects: %', role_name;
    END IF;
  END LOOP;
  IF NOT pg_has_role('oliginvest_backup', 'pg_read_all_data', 'MEMBER') THEN
    RAISE EXCEPTION 'Backup role is missing its read membership';
  END IF;

  FOR table_row IN
    SELECT c.oid, c.relname, c.relowner, c.relrowsecurity, c.relforcerowsecurity, n.nspname,
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped) AS has_user
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = ANY(ARRAY['auth', 'identity', 'platform', 'notifications', 'market', 'portfolio', 'analytics', 'alerts', 'education'])
  LOOP
    IF table_row.relowner <> 'oliginvest_owner'::regrole THEN
      RAISE EXCEPTION 'Unexpected table owner: %.%', table_row.nspname, table_row.relname;
    END IF;
    IF table_row.has_user AND table_row.nspname <> 'auth' THEN
      IF NOT table_row.relrowsecurity OR NOT table_row.relforcerowsecurity
        OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = table_row.oid AND 'oliginvest_app'::regrole = ANY(polroles))
      THEN RAISE EXCEPTION 'Missing forced RLS/policy: %.%', table_row.nspname, table_row.relname; END IF;
    END IF;
    IF has_table_privilege('oliginvest_analytics_ro', table_row.oid, 'SELECT')
      <> (table_row.nspname = 'market' AND table_row.relname = ANY(expected_market_tables))
    THEN RAISE EXCEPTION 'Unexpected analytics SELECT grant: %.%', table_row.nspname, table_row.relname; END IF;
    IF has_table_privilege('oliginvest_analytics_ro', table_row.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Analytics role can mutate: %.%', table_row.nspname, table_row.relname;
    END IF;
    IF table_row.nspname = 'auth' AND has_table_privilege('oliginvest_app', table_row.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'App role has an auth table grant: %', table_row.relname;
    END IF;
    IF table_row.nspname NOT IN ('auth', 'drizzle')
      AND has_table_privilege('oliginvest_auth', table_row.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN RAISE EXCEPTION 'Auth role has a domain table grant: %.%', table_row.nspname, table_row.relname; END IF;
  END LOOP;
  FOR function_row IN
    SELECT p.* FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'identity' AND p.prosecdef
  LOOP
    IF function_row.proowner <> 'oliginvest_owner'::regrole
      OR NOT ('search_path=pg_catalog, identity' = ANY(coalesce(function_row.proconfig, ARRAY[]::text[])))
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    THEN RAISE EXCEPTION 'Unsafe SECURITY DEFINER function: %', function_row.proname; END IF;
  END LOOP;
END $$;

-- FORCE RLS also applies to the owner, independently of application role labels.
BEGIN;
SET LOCAL ROLE oliginvest_owner;
SET LOCAL app.role = 'admin';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM portfolio.accounts) THEN RAISE EXCEPTION 'Owner bypasses FORCE RLS'; END IF;
END $$;
ROLLBACK;
