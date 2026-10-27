"""Stress-test market data (BL-556): BLOCK rules, windows, beta months, child outcome codes."""

import asyncio
import json
from typing import Any

import pytest

from oliginvest_analytics import runner
from oliginvest_analytics.execution import _parse
from oliginvest_analytics.market_data import DataQualityHold
from oliginvest_analytics.stress import CoverageTooLow, NoScenarioData
from oliginvest_analytics.stress_data import beta_months, load_stress_inputs

STOCK = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d11"
WIG = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01"
SPX = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d02"


class Cursor:
    def __init__(self, holds: list[str] | None = None) -> None:
        self.holds = holds or []
        self.rows: list[tuple[Any, ...]] = []
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        self.calls.append((query, params))
        if "data_quality_issues" in query:
            self.rows = [(i,) for i in self.holds]
        elif "FROM market.instruments" in query:
            self.rows = [
                (STOCK, "PLN", "ABC"),
                (WIG, "PLN", "WIG"),
                (SPX, "USD", "^SP500TR"),
            ]
        elif "bars_daily" in query and "BETWEEN" in query:
            self.rows = [
                (STOCK, "2020-02-18", "100.5", "10"),
                (STOCK, "2020-03-23", "90", None),
                (SPX, "2020-02-18", "1000", None),
            ]
        elif "fx_rates" in query and "BETWEEN" in query:
            self.rows = [("2020-02-18", "4.0123")]
        elif "bars_daily" in query:
            self.rows = [(WIG, "2021-01", "50000"), (STOCK, "2021-01", "100")]
        else:
            self.rows = [("2021-01", "3.9")]

    async def fetchall(self) -> list[tuple[Any, ...]]:
        return self.rows


def job(hypothetical: list[Any] | None = None) -> dict[str, Any]:
    return {
        "params": {
            "historical": [
                {
                    "key": "covid_2020",
                    "name": "Krach",
                    "from": "2020-02-19",
                    "to": "2020-03-23",
                }
            ],
            "hypothetical": hypothetical or [],
        },
        "portfolio": {
            "asOf": "2026-10-24",
            "positions": [
                {
                    "instrumentId": STOCK,
                    "proxyInstrumentId": SPX,
                    "value": {"amount": "1.00", "currency": "PLN"},
                }
            ],
            "cash": {"amount": "0", "currency": "PLN"},
        },
    }


def test_beta_window_is_sixty_one_complete_months_before_the_snapshot() -> None:
    months = beta_months("2026-10-24")
    assert len(months) == 61 and months[0] == "2021-09" and months[-1] == "2026-09"
    assert beta_months("2026-01-05")[-1] == "2025-12"


def test_windows_rates_and_versions_without_user_tables() -> None:
    cursor = Cursor()
    data = asyncio.run(
        load_stress_inputs(
            cursor, job([{"kind": "index_shock", "instrumentId": WIG, "shock": -0.3}])
        )
    )
    window = data["historical"]["covid_2020"]
    assert window["bars"][STOCK] == [
        ("2020-02-18", 100.5, 10.0),
        ("2020-03-23", 90.0, None),
    ]
    assert window["fx"] == {"USD": [("2020-02-18", 4.0123)]}
    assert data["monthly"]["closes"][WIG] == {"2021-01": 50000.0}
    assert data["monthly"]["fx"] == {"USD": {"2021-01": 3.9}}
    assert data["data_version"] == {
        "scenario:covid_2020": "2020-02-19..2020-03-23",
        "monthly": "2021-09..2026-09",
    }
    assert data["currencies"][SPX] == "USD" and data["tickers"][WIG] == "WIG"
    assert all(
        "portfolio." not in query and "analytics." not in query
        for query, _ in cursor.calls
    )
    json.dumps(data)  # travels to the child process as JSON


def test_block_on_proxy_or_factor_holds_the_run_but_own_series_falls_back() -> None:
    with pytest.raises(DataQualityHold):
        asyncio.run(load_stress_inputs(Cursor([SPX]), job()))
    factor = [{"kind": "index_shock", "instrumentId": WIG, "shock": -0.3}]
    with pytest.raises(DataQualityHold):
        asyncio.run(load_stress_inputs(Cursor([WIG]), job(factor)))
    data = asyncio.run(load_stress_inputs(Cursor([STOCK]), job()))
    assert data["holds"] == [STOCK]
    assert data["monthly"]["months"] == []  # no hypothetical shock, no beta window read


def test_child_outcome_codes_for_refusals() -> None:
    def refuse(error: Exception) -> runner.Handler:
        def handler(*_: Any) -> dict[str, Any]:
            raise error

        return handler

    request = json.dumps({"type": "stress_test", "job": {}, "data": {}}).encode()
    for error, code in (
        (CoverageTooLow(), "COVERAGE_TOO_LOW"),
        (NoScenarioData(), "INSUFFICIENT_DATA"),
    ):
        outcome = runner.run(request, {"stress_test": refuse(error)}, lambda *_: None)
        assert outcome == {"status": "failed", "code": code}
        assert _parse(json.dumps(outcome).encode()).code == code
    assert set(runner.HANDLERS) == {"monte_carlo", "stress_test", "goal"}
