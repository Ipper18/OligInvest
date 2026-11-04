FROM postgres:18.6-trixie@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae
# apt 3.0.4 (DSA-6607-1, CVE-2026-109518: package verification bypass on retried downloads) was published
# 2026-11-04T12:03Z; the owner accepted it inside the 72-hour window (2026-11-04). Retries stay off while the
# vulnerable apt fetches the fix.
RUN apt-get -o Acquire::Retries=0 update -qq && apt-get -o Acquire::Retries=0 install -y --no-install-recommends pgbackrest=2.59.3-1.pgdg13+1 apt=3.0.4 libapt-pkg7.0=3.0.4 \
    && rm -rf /var/lib/apt/lists/*
# This image always starts as postgres; the root-only privilege switch is unused.
RUN rm /usr/local/bin/gosu
COPY packages/db/sql/bootstrap.sql packages/db/admin-migrations/0001-role-timeouts.sql /opt/oliginvest/
COPY infra/postgres/initialize.sh /docker-entrypoint-initdb.d/10-roles.sh
COPY infra/postgres/backup.sh /usr/local/bin/oliginvest-pgbackrest
RUN chmod 755 /usr/local/bin/oliginvest-pgbackrest && mkdir -p /var/lib/pgbackrest /var/spool/pgbackrest && chown -R 999:999 /var/lib/pgbackrest /var/spool/pgbackrest
USER 999:999
