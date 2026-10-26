"""BL-311 isolation probe, piped into the production analytics container by ci-images.mjs.

ADR-003 § 2: no route to the internet; oliginvest_analytics_ro reads market data,
including data-quality findings, and nothing else; it cannot write anywhere.
"""

import os
import socket
import urllib.error
import urllib.request

import psycopg

for attempt in (
    lambda: urllib.request.urlopen("http://example.com/", timeout=3),
    lambda: socket.create_connection(("1.1.1.1", 443), timeout=3),
    lambda: socket.create_connection(("2606:4700:4700::1111", 443), timeout=3),
):
    try:
        attempt()
    except (OSError, urllib.error.URLError):
        continue
    raise RuntimeError("Analytics reached the internet")
print("PASS: analytics has no internet egress")

with open(os.environ["DB_ANALYTICS_RO_PASSWORD_FILE"], encoding="utf-8") as stream:
    password = stream.read().removesuffix("\n")
connection = psycopg.connect(
    host=os.environ["DB_HOST"],
    dbname=os.environ["DB_NAME"],
    user="oliginvest_analytics_ro",
    password=password,
    autocommit=True,
)
for table in ("market.bars_daily", "market.instruments", "market.data_quality_issues"):
    connection.execute(f"SELECT count(*) FROM {table}").fetchone()
denied = (
    "SELECT 1 FROM portfolio.transactions LIMIT 1",
    "SELECT 1 FROM analytics.analytics_runs LIMIT 1",
    "SELECT 1 FROM market.watchlists LIMIT 1",
    "SELECT 1 FROM auth.users LIMIT 1",
    "UPDATE market.data_quality_issues SET status = status",
    "INSERT INTO market.bars_daily SELECT * FROM market.bars_daily LIMIT 0",
    "DELETE FROM market.instruments WHERE false",
    "CREATE TABLE public.analytics_probe (id int)",
)
for statement in denied:
    try:
        connection.execute(statement)
    except psycopg.errors.InsufficientPrivilege:
        continue
    raise RuntimeError("Analytics role exceeded market read access")
print("PASS: analytics_ro reads market data and quality issues only, without writes")

# BL-313: every Monte Carlo market-data query runs as analytics_ro (syntax and grants).
from oliginvest_analytics import market_data  # noqa: E402

probe_id = "00000000-0000-7000-8000-000000000001"
for query, params in (
    (market_data._HOLDS, ([probe_id],)),
    (market_data._CURRENCIES, ([probe_id],)),
    (market_data._CLOSES, (probe_id, "2026-10-01")),
    (market_data._FX, ("USD", "2026-10-01")),
    (market_data._RISK_FREE, ("2026-10-01",)),
):
    connection.execute(query, params).fetchall()
print("PASS: Monte Carlo market-data queries run as analytics_ro")
