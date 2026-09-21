-- Run once as database administrator. Role passwords are provisioned separately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_owner') THEN
    CREATE ROLE oliginvest_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_auth') THEN
    CREATE ROLE oliginvest_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_app') THEN
    CREATE ROLE oliginvest_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_analytics_ro') THEN
    CREATE ROLE oliginvest_analytics_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'oliginvest_backup') THEN
    CREATE ROLE oliginvest_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;

GRANT pg_read_all_data TO oliginvest_backup;                -- kopie zapasowe (pg_dump); poświadczenia poza kontenerami aplikacji
DO $$ BEGIN EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO oliginvest_owner', current_database()); END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO oliginvest_auth, oliginvest_app, oliginvest_analytics_ro, oliginvest_backup', current_database()); END $$;
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
