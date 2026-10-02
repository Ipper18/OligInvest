#!/bin/sh
set -eu
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /opt/oliginvest/bootstrap.sql -f /opt/oliginvest/0001-role-timeouts.sql >/dev/null
# Server-side file reads keep passwords out of command lines, environment and SQL logs.
psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL' >/dev/null
DO $block$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('oliginvest_owner', 'DB_OWNER_PASSWORD'),
    ('oliginvest_auth', 'DB_AUTH_PASSWORD'),
    ('oliginvest_app', 'DB_APP_PASSWORD'),
    ('oliginvest_analytics_ro', 'DB_ANALYTICS_RO_PASSWORD'),
    ('oliginvest_backup', 'DB_BACKUP_PASSWORD')
  ) AS roles(name, secret)
  LOOP
    EXECUTE format('ALTER ROLE %I PASSWORD %L', item.name, trim(pg_read_file('/run/secrets/' || item.secret)));
  END LOOP;
END
$block$;
SQL
