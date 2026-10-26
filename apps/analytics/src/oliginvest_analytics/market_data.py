"""Market data for analyses, read by the worker parent as `oliginvest_analytics_ro` (ADR-003).

Only market tables: proxy month-end closes, NBP month-end FX rates, the NBP reference rate and
open data-quality findings. User data never comes from the database — it travels in the job.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from .montecarlo import MarketInputs


class DataQualityHold(ValueError):
    """An input series has an open BLOCK finding (obliczenia-finansowe.md § 14)."""


@dataclass(frozen=True)
class Database:
    host: str
    port: int
    name: str
    password: str
    ssl: bool


class Cursor(Protocol):
    async def execute(self, query: str, params: Sequence[Any] = ...) -> Any: ...
    async def fetchall(self) -> list[tuple[Any, ...]]: ...


_HOLDS = """SELECT DISTINCT instrument_id::text FROM market.data_quality_issues
WHERE instrument_id = ANY(%s::uuid[]) AND status = 'open' AND severity = 'BLOCK'"""
_CURRENCIES = (
    "SELECT id::text, currency, coalesce(ticker, id::text) FROM market.instruments"
    " WHERE id = ANY(%s::uuid[])"
)
# Month-end close of complete months before the snapshot month; split-adjusted (§ 3.4).
_CLOSES = """SELECT DISTINCT ON (date_trunc('month', session_date))
  to_char(session_date, 'YYYY-MM'), (close * adjustment_factor)::text
FROM market.bars_daily
WHERE instrument_id = %s::uuid AND session_date < date_trunc('month', %s::date)
ORDER BY date_trunc('month', session_date), session_date DESC"""
_FX = """SELECT DISTINCT ON (date_trunc('month', rate_date))
  to_char(rate_date, 'YYYY-MM'), rate::text
FROM market.fx_rates
WHERE base = %s AND quote = 'PLN' AND rate_date < date_trunc('month', %s::date)
ORDER BY date_trunc('month', rate_date), rate_date DESC, (source = 'nbp') DESC"""
_RISK_FREE = """SELECT o.obs_date::text, o.value::text FROM market.macro_observations o
JOIN market.macro_series s ON s.id = o.series_id
WHERE s.code = 'NBP:REF_RATE' AND o.obs_date <= %s::date
ORDER BY o.obs_date DESC LIMIT 1"""


def _previous(month: str) -> str:
    year, number = int(month[:4]), int(month[5:])
    return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"


def monthly_returns(prices: Mapping[str, Decimal]) -> dict[str, float]:
    """Return of month m = P(m) / P(m-1) − 1, only for consecutive months (gaps stay gaps)."""
    return {
        month: float(price / prices[_previous(month)] - 1)
        for month, price in prices.items()
        if _previous(month) in prices and prices[_previous(month)] > 0
    }


async def load_inputs(
    cursor: Cursor, proxies: Sequence[str], as_of: str
) -> MarketInputs:
    ids = sorted(set(proxies))
    await cursor.execute(_HOLDS, (ids,))
    if await cursor.fetchall():
        raise DataQualityHold()
    await cursor.execute(_CURRENCIES, (ids,))
    catalog = await cursor.fetchall()
    currencies = {row[0]: row[1] for row in catalog}
    tickers = {row[0]: row[2] for row in catalog}
    fx: dict[str, dict[str, Decimal]] = {}
    series: dict[str, dict[str, float]] = {}
    version: dict[str, str] = {}
    for proxy in ids:
        currency = currencies.get(proxy)
        if currency is None:
            raise DataQualityHold()
        await cursor.execute(_CLOSES, (proxy, as_of))
        closes = {month: Decimal(value) for month, value in await cursor.fetchall()}
        if currency != "PLN":
            if currency not in fx:
                await cursor.execute(_FX, (currency, as_of))
                fx[currency] = {
                    month: Decimal(rate) for month, rate in await cursor.fetchall()
                }
                if fx[currency]:
                    version[f"fx:{currency}"] = (
                        f"{min(fx[currency])}..{max(fx[currency])}"
                    )
            closes = {
                m: p * fx[currency][m] for m, p in closes.items() if m in fx[currency]
            }
        series[proxy] = monthly_returns(closes)
        if closes:
            version[proxy] = f"{min(closes)}..{max(closes)}"
    common = (
        sorted(set.intersection(*(set(s) for s in series.values()))) if series else []
    )
    await cursor.execute(_RISK_FREE, (as_of,))
    rate = await cursor.fetchall()
    return MarketInputs(
        months=common,
        returns={proxy: [series[proxy][m] for m in common] for proxy in ids},
        cash_rate=float(Decimal(rate[0][1]) / 100) if rate else None,
        cash_rate_date=rate[0][0] if rate else None,
        data_version=version,
        tickers=tickers,
    )
