FROM postgres:18.6-trixie@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae
RUN apt-get update -qq && apt-get install -y --no-install-recommends pgbackrest=2.59.1-1.pgdg13+1 && rm -rf /var/lib/apt/lists/*
COPY packages/db/sql/bootstrap.sql packages/db/admin-migrations/0001-role-timeouts.sql /opt/oliginvest/
COPY infra/postgres/initialize.sh /docker-entrypoint-initdb.d/10-roles.sh
COPY infra/postgres/backup.sh /usr/local/bin/oliginvest-pgbackrest
RUN chmod 755 /usr/local/bin/oliginvest-pgbackrest && mkdir -p /var/lib/pgbackrest /var/spool/pgbackrest && chown -R 999:999 /var/lib/pgbackrest /var/spool/pgbackrest
USER 999:999
