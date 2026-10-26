"""Market data for Monte Carlo (BL-313): BLOCK gate, PLN conversion, gaps, risk-free rate."""

import asyncio
from decimal import Decimal
from typing import Any

import pytest

from oliginvest_analytics.market_data import (
    DataQualityHold,
    load_inputs,
    monthly_returns,
)

PLN = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01"
USD = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d02"


class Cursor:
    """Answers queries by their table; records parameters (never SQL with values)."""

    def __init__(self, tables: dict[str, Any]) -> None:
        self.tables = tables
        self.rows: list[tuple[Any, ...]] = []
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        self.calls.append((query, params))
        if "data_quality_issues" in query:
            self.rows = self.tables["holds"]
        elif "FROM market.instruments" in query:
            self.rows = self.tables["currencies"]
        elif "bars_daily" in query:
            self.rows = self.tables["closes"][params[0]]
        elif "fx_rates" in query:
            self.rows = self.tables["fx"][params[0]]
        else:
            self.rows = self.tables["rate"]

    async def fetchall(self) -> list[tuple[Any, ...]]:
        return self.rows


def tables(**overrides: Any) -> dict[str, Any]:
    base = {
        "holds": [],
        "currencies": [(PLN, "PLN", "WIG"), (USD, "USD", "^GSPC")],
        "closes": {
            PLN: [
                ("2024-01", "100"),
                ("2024-02", "110"),
                ("2024-03", "99"),
                ("2024-05", "120"),
                ("2024-06", "120"),
            ],
            USD: [
                ("2024-01", "10"),
                ("2024-02", "10"),
                ("2024-03", "11"),
                ("2024-04", "11"),
                ("2024-06", "12"),
            ],
        },
        "fx": {
            "USD": [
                ("2024-01", "4.0"),
                ("2024-02", "4.4"),
                ("2024-03", "4.4"),
                ("2024-04", "4.0"),
                ("2024-06", "4.0"),
            ]
        },
        "rate": [("2025-07-03", "5.00000000")],
    }
    return {**base, **overrides}


def test_monthly_returns_skip_gaps_instead_of_bridging_them() -> None:
    prices = {"2024-01": Decimal(100), "2024-02": Decimal(110), "2024-04": Decimal(121)}
    assert monthly_returns(prices) == {"2024-02": pytest.approx(0.1)}
    assert monthly_returns({"2023-12": Decimal(100), "2024-01": Decimal(50)}) == {
        "2024-01": pytest.approx(-0.5)
    }


def test_returns_are_in_pln_on_common_months_with_versions_and_rate() -> None:
    cursor = Cursor(tables())
    data = asyncio.run(load_inputs(cursor, [USD, PLN, PLN], "2026-10-19"))
    # PLN: 02, 03 (05 has no 04, 06 follows 05); USD×FX: 02, 03, 04 (06 lacks 05).
    assert data.months == ["2024-02", "2024-03"]
    assert data.returns[PLN] == pytest.approx([0.1, -0.1])
    assert data.returns[USD] == pytest.approx([0.1, 0.1])  # 40→44→48.4 PLN
    assert data.cash_rate == pytest.approx(0.05) and data.cash_rate_date == "2025-07-03"
    assert data.tickers == {PLN: "WIG", USD: "^GSPC"}
    assert data.data_version == {
        PLN: "2024-01..2024-06",
        "fx:USD": "2024-01..2024-06",
        USD: "2024-01..2024-06",
    }
    # Every query is parameterised with the snapshot date (complete months before it).
    assert all("%s" in query for query, _ in cursor.calls)
    assert ("USD", "2026-10-19") in [params for _, params in cursor.calls]


def test_open_block_on_a_proxy_stops_the_analysis() -> None:
    with pytest.raises(DataQualityHold):
        asyncio.run(load_inputs(Cursor(tables(holds=[(PLN,)])), [PLN], "2026-10-19"))


def test_unknown_proxy_and_missing_rate() -> None:
    with pytest.raises(DataQualityHold):
        asyncio.run(load_inputs(Cursor(tables(currencies=[])), [PLN], "2026-10-19"))
    data = asyncio.run(load_inputs(Cursor(tables(rate=[])), [PLN], "2026-10-19"))
    assert data.cash_rate is None and data.cash_rate_date is None
