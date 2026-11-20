# Rebuild of postgres:18.6-trixie pushed 2026-11-06T19:08Z (outside the 72-hour window): ships xz-utils/liblzma5
# 5.8.1-1+deb13u2 (DSA-6549-1) and apt 3.0.4; PostgreSQL stays 18.6-1.pgdg13+2.
FROM postgres:18.6-trixie@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42
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
