"""Market data for stress tests, read by the worker parent as `oliginvest_analytics_ro` (§ 12.3).

Only market tables: adjusted daily closes and no-trade flags inside each historical window, NBP rates for
the same range, month-end closes and rates of the beta window, the catalogue and open BLOCK
findings. User data never comes from the database — positions travel in the job.
"""

from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from typing import Any

from .market_data import _CURRENCIES, _HOLDS, Cursor, DataQualityHold
from .stress import BETA_MONTHS

# Ten calendar days before the window: the start point may be up to 7 days old (§ 12.3).
_WINDOW_BARS = """SELECT instrument_id::text, session_date::text,
  (close * adjustment_factor)::text, no_trades
FROM market.bars_daily
WHERE instrument_id = ANY(%s::uuid[])
  AND session_date BETWEEN %s::date - 10 AND %s::date
ORDER BY instrument_id, session_date"""
# NBP table A only: another source on a day without a table would break the carry-forward.
_WINDOW_FX = """SELECT rate_date::text, rate::text
FROM market.fx_rates
WHERE base = %s AND quote = 'PLN' AND source = 'nbp'
  AND rate_date BETWEEN %s::date - 10 AND %s::date
ORDER BY rate_date"""
# Month-end closes of the BETA_MONTHS + 1 complete months before the snapshot month.
_MONTH_CLOSES = """SELECT DISTINCT ON (instrument_id, date_trunc('month', session_date))
  instrument_id::text, to_char(session_date, 'YYYY-MM'), (close * adjustment_factor)::text
FROM market.bars_daily
WHERE instrument_id = ANY(%s::uuid[])
  AND session_date < date_trunc('month', %s::date)
  AND session_date >= date_trunc('month', %s::date) - make_interval(months => %s)
ORDER BY instrument_id, date_trunc('month', session_date), session_date DESC"""
_MONTH_FX = """SELECT DISTINCT ON (date_trunc('month', rate_date))
  to_char(rate_date, 'YYYY-MM'), rate::text
FROM market.fx_rates
WHERE base = %s AND quote = 'PLN'
  AND rate_date < date_trunc('month', %s::date)
  AND rate_date >= date_trunc('month', %s::date) - make_interval(months => %s)
ORDER BY date_trunc('month', rate_date), rate_date DESC, (source = 'nbp') DESC"""


def beta_months(as_of: str) -> list[str]:
    """BETA_MONTHS + 1 month labels before the snapshot month (the first is the base price)."""
    snapshot = date.fromisoformat(as_of)
    index = snapshot.year * 12 + snapshot.month - 1
    return [
        f"{m // 12}-{m % 12 + 1:02d}" for m in range(index - BETA_MONTHS - 1, index)
    ]


def _number(text: str | None) -> float | None:
    return None if text is None else float(Decimal(text))


async def load_stress_inputs(cursor: Cursor, job: Mapping[str, Any]) -> dict[str, Any]:
    params, portfolio = job["params"], job["portfolio"]
    positions = portfolio["positions"]
    own = {p["instrumentId"] for p in positions}
    proxies = {p["proxyInstrumentId"] for p in positions}
    factors = {
        h["instrumentId"] for h in params["hypothetical"] if h["kind"] == "index_shock"
    }
    ids = sorted(own | proxies | factors)
    await cursor.execute(_HOLDS, (ids,))
    holds = {row[0] for row in await cursor.fetchall()}
    # Proxies and factors stand in for others: a BLOCK there stops the analysis (§ 14);
    # a BLOCK on a position's own series only moves that position to its proxy.
    if holds & (proxies | factors):
        raise DataQualityHold()
    await cursor.execute(_CURRENCIES, (ids,))
    catalog = await cursor.fetchall()
    currencies = {row[0]: row[1] for row in catalog}
    tickers = {row[0]: row[2] for row in catalog}
    if any(i not in currencies for i in proxies | factors):
        raise DataQualityHold()
    foreign = sorted({c for c in currencies.values() if c != "PLN"})
    version: dict[str, str] = {}
    historical: dict[str, Any] = {}
    for scenario in params["historical"]:
        start, end = scenario["from"], scenario["to"]
        await cursor.execute(_WINDOW_BARS, (ids, start, end))
        bars: dict[str, list[tuple[str, float, bool]]] = {}
        for instrument, day, close, no_trades in await cursor.fetchall():
            value = _number(close)
            if value is not None:
                bars.setdefault(instrument, []).append((day, value, bool(no_trades)))
        fx: dict[str, list[tuple[str, float]]] = {}
        for currency in foreign:
            await cursor.execute(_WINDOW_FX, (currency, start, end))
            fx[currency] = [
                (day, float(Decimal(rate))) for day, rate in await cursor.fetchall()
            ]
        historical[scenario["key"]] = {"bars": bars, "fx": fx}
        version[f"scenario:{scenario['key']}"] = f"{start}..{end}"
    monthly: dict[str, Any] = {"months": [], "closes": {}, "fx": {}}
    if params["hypothetical"]:
        as_of = portfolio["asOf"]
        months = beta_months(as_of)
        span = BETA_MONTHS + 1
        await cursor.execute(_MONTH_CLOSES, (ids, as_of, as_of, span))
        closes: dict[str, dict[str, float]] = {}
        for instrument, month, close in await cursor.fetchall():
            closes.setdefault(instrument, {})[month] = float(Decimal(close))
        rates: dict[str, dict[str, float]] = {}
        shocked = {
            h["currency"] for h in params["hypothetical"] if h["kind"] == "fx_shock"
        }
        for currency in sorted(set(foreign) | shocked):
            await cursor.execute(_MONTH_FX, (currency, as_of, as_of, span))
            rates[currency] = {m: float(Decimal(r)) for m, r in await cursor.fetchall()}
        monthly = {"months": months, "closes": closes, "fx": rates}
        version["monthly"] = f"{months[0]}..{months[-1]}"
    monthly["currencies"] = currencies
    return {
        "currencies": currencies,
        "tickers": tickers,
        "holds": sorted(holds & own),
        "historical": historical,
        "monthly": monthly,
        "data_version": version,
    }
