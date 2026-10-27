"""Stress tests (BL-556, § 12.3) on synthetic data: ranges, explicit proxies, coverage, no look-ahead."""

import copy
from typing import Any

import numpy as np
import pytest

from oliginvest_analytics.contracts import check_result
from oliginvest_analytics.stress import (
    BETA_MONTHS,
    Z90,
    CoverageTooLow,
    NoScenarioData,
    regress,
    run_stress_test,
    window_series,
)

STOCK = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d11"  # GPW stock with its own history
US = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d12"  # US stock without history in the window
WIG = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01"
SPX = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d02"
RUN = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e"
COVID = {
    "key": "covid_2020",
    "name": "Krach pandemiczny 2020",
    "from": "2020-02-19",
    "to": "2020-03-23",
}


def job(
    historical: list[Any] | None = None, hypothetical: list[Any] | None = None
) -> dict[str, Any]:
    return {
        "v": 1,
        "runId": RUN,
        "type": "stress_test",
        "requestedAt": "2026-10-27T10:00:00Z",
        "params": {
            "historical": [COVID] if historical is None else historical,
            "hypothetical": hypothetical or [],
        },
        "portfolio": {
            "asOf": "2026-10-24",
            "positions": [
                {
                    "instrumentId": STOCK,
                    "proxyInstrumentId": WIG,
                    "value": {"amount": "600.00", "currency": "PLN"},
                },
                {
                    "instrumentId": US,
                    "proxyInstrumentId": SPX,
                    "value": {"amount": "400.00", "currency": "PLN"},
                },
            ],
            "cash": {"amount": "100.00", "currency": "PLN"},
        },
    }


def window(**bars: Any) -> dict[str, Any]:
    base = {
        STOCK: [
            ("2020-02-18", 100.0, False),
            ("2020-03-02", 80.0, False),
            ("2020-03-23", 90.0, False),
        ],
        WIG: [("2020-02-18", 50.0, False), ("2020-03-23", 40.0, False)],
        SPX: [
            ("2020-02-18", 1000.0, False),
            ("2020-03-02", 950.0, False),
            ("2020-03-20", 900.0, False),
        ],
    }
    base.update(bars)
    return {
        "bars": base,
        "fx": {"USD": [("2020-02-18", 4.0), ("2020-03-02", 4.2), ("2020-03-20", 4.4)]},
    }


def data(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "currencies": {STOCK: "PLN", US: "USD", WIG: "PLN", SPX: "USD"},
        "tickers": {STOCK: "ABC", US: "XYZ", WIG: "WIG", SPX: "^SP500TR"},
        "holds": [],
        "historical": {"covid_2020": window()},
        "monthly": {"months": [], "closes": {}, "fx": {}, "currencies": {}},
        "data_version": {"scenario:covid_2020": "2020-02-19..2020-03-23"},
    }
    base.update(overrides)
    return base


def envelope(output: dict[str, Any]) -> dict[str, Any]:
    return {
        "v": 1,
        "runId": RUN,
        "status": "done",
        "finishedAt": "2026-10-27T10:00:05Z",
        "durationMs": 50,
        **output,
    }


def codes(output: dict[str, Any]) -> list[str]:
    return [w["code"] for w in output["warnings"]]


def test_historical_scenario_is_a_path_range_on_current_positions() -> None:
    output = run_stress_test(job(), data())
    assert check_result(envelope(output))
    row = output["result"]["scenarios"][0]
    # V0 = 600 + 400 + 100. 2020-03-20: stock 0.8 (carried), proxy 900·4.4/(1000·4.0) = 0.99
    # → 480 + 396 + 100 = 976 (trough). 2020-03-23: stock 0.9 → 540 + 396 + 100 = 1036.
    assert row["status"] == "ok"
    assert row["portfolioReturn"] == round(1036 / 1100 - 1, 6)
    assert row["portfolioLoss"] == {
        "amount": "64.00",
        "currency": "PLN",
    }  # positive = falls
    assert row["returnRange"] == {
        "low": round(976 / 1100 - 1, 6),
        "high": 0.0,
        "basis": "window_path",
    }
    assert row["troughDate"] == "2020-03-20"
    assert (row["coverageRatio"], row["ownHistoryRatio"]) == (1.0, 0.6)
    stock, us = row["positions"]
    assert stock["series"] == "instrument" and stock["returnRatio"] == -0.1
    assert stock["proxyReturnRatio"] == -0.2  # survivorship disclosure: WIG fell more
    assert us["series"] == "proxy" and us["proxyInstrumentId"] == SPX
    assert (
        us["returnRatio"] == -0.01 and us["localReturnRatio"] == -0.1
    )  # PLN cushioned USD
    assert us["loss"] == {"amount": "4.00", "currency": "PLN"}
    assert {
        "HISTORICAL_PATH_NOT_WORST_CASE",
        "PROXY_SUBSTITUTED",
        "CASH_ZERO_RETURN",
    } <= set(codes(output))
    assert output["reproducibility"]["algorithmVersion"] == "stress-1.0.0"
    assert "seed" not in output["reproducibility"]  # deterministic analysis


def test_data_after_the_window_does_not_change_the_result() -> None:
    later = window()
    later["bars"][STOCK] = [
        *later["bars"][STOCK],
        ("2020-03-24", 10.0, False),
        ("2026-10-01", 500.0, False),
    ]
    later["fx"]["USD"] = [*later["fx"]["USD"], ("2020-03-24", 9.0)]
    assert run_stress_test(
        job(), data(historical={"covid_2020": later})
    ) == run_stress_test(job(), data())


def test_edges_need_a_close_at_most_seven_days_old() -> None:
    bars = [("2020-02-11", 100.0, False), ("2020-03-23", 90.0, False)]
    assert (
        window_series(bars, None, "2020-02-19", "2020-03-23") is None
    )  # 8 days before
    assert window_series(bars, None, "2020-02-18", "2020-03-23") is not None
    assert window_series(bars, None, "2020-02-18", "2020-04-01") is None  # 9 days after
    assert (
        window_series(bars, [("2020-03-01", 4.0)], "2020-02-18", "2020-03-23") is None
    )  # no rate at start


def test_low_coverage_refuses_the_scenario_with_null_numbers() -> None:
    gaps = window(**{SPX: [], WIG: []})
    gaps["bars"][STOCK] = []
    hypothetical = [{"kind": "correlation_shock", "correlation": 0.9}]
    with pytest.raises(CoverageTooLow):
        run_stress_test(job(), data(historical={"covid_2020": gaps}))
    output = run_stress_test(
        job(hypothetical=hypothetical),
        data(historical={"covid_2020": gaps}, monthly=monthly()),
    )
    refused = output["result"]["scenarios"][0]
    assert refused["status"] == "coverage_too_low" and refused["coverageRatio"] == 0.0
    assert refused["portfolioReturn"] is None and refused["portfolioLoss"] is None
    assert refused["returnRange"] is None
    assert all(p["returnRatio"] is None for p in refused["positions"])
    assert "SCENARIO_REFUSED" in codes(output)
    assert check_result(envelope(output))


def test_partial_coverage_reports_the_covered_part() -> None:
    gaps = window(**{SPX: []})  # US 400 of 1000 uncovered → 60 % < 80 %: refused
    with pytest.raises(CoverageTooLow):
        run_stress_test(job(), data(historical={"covid_2020": gaps}))
    small = job()
    small["portfolio"]["positions"][1]["value"]["amount"] = (
        "100.00"  # 100 of 700 uncovered
    )
    row = run_stress_test(small, data(historical={"covid_2020": gaps}))
    scenario = row["result"]["scenarios"][0]
    assert scenario["status"] == "ok" and scenario["coverageRatio"] == round(
        600 / 700, 6
    )
    # Covered part only: stock 600 and cash 100 → (540 + 100) / 700 − 1.
    assert scenario["portfolioReturn"] == round(640 / 700 - 1, 6)
    assert "PARTIAL_COVERAGE" in codes(row)


def test_a_block_on_the_own_series_moves_the_position_to_its_proxy() -> None:
    output = run_stress_test(job(), data(holds=[STOCK]))
    stock = output["result"]["scenarios"][0]["positions"][0]
    assert stock["series"] == "proxy" and stock["returnRatio"] == -0.2
    assert "OWN_SERIES_QUALITY_HOLD" in codes(output)


def test_illiquid_series_is_flagged() -> None:
    idle = window(
        **{
            STOCK: [
                ("2020-02-18", 100.0, False),
                ("2020-03-02", 100.0, True),
                ("2020-03-23", 90.0, True),
            ]
        }
    )
    output = run_stress_test(job(), data(historical={"covid_2020": idle}))
    assert output["result"]["scenarios"][0]["positions"][0]["illiquid"] is True
    assert "ILLIQUID_SERIES" in codes(output)


# ── hypothetical shocks on 60 monthly returns ─────────────────────────────────


def monthly(beta_stock: float = 1.5, noise: float = 0.002) -> dict[str, Any]:
    rng = np.random.default_rng(7)
    months = [f"{2021 + (i // 12)}-{i % 12 + 1:02d}" for i in range(BETA_MONTHS + 1)]
    factor = rng.normal(0.005, 0.04, BETA_MONTHS)
    usd = rng.normal(0.0, 0.02, BETA_MONTHS)

    def prices(returns: np.ndarray, start: float) -> dict[str, float]:
        values = start * np.concatenate([[1.0], np.cumprod(1 + returns)])
        return {m: float(v) for m, v in zip(months, values, strict=True)}

    stock = beta_stock * factor + rng.normal(0, noise, BETA_MONTHS)
    spx_local = 0.8 * factor + rng.normal(0, 0.01, BETA_MONTHS)
    return {
        "months": months,
        "closes": {
            WIG: prices(factor, 50000),
            STOCK: prices(stock, 100),
            SPX: prices(spx_local, 4000),
        },
        "fx": {"USD": prices(usd, 4.0)},
        "currencies": {STOCK: "PLN", US: "USD", WIG: "PLN", SPX: "USD"},
    }


def test_index_shock_uses_the_beta_interval_and_explicit_proxy() -> None:
    shock = {"kind": "index_shock", "instrumentId": WIG, "shock": -0.3}
    output = run_stress_test(
        job(historical=[], hypothetical=[shock]), data(monthly=monthly())
    )
    assert check_result(envelope(output))
    row = output["result"]["scenarios"][0]
    assert row["key"] == "index_shock_1" and row["status"] == "ok"
    assert row["name"].startswith("Spadek WIG o 30%")
    stock, us = row["positions"]
    assert stock["series"] == "instrument" and us["series"] == "proxy"
    assert (
        stock["betaLow"] < 1.5 < stock["betaHigh"] and abs(stock["beta"] - 1.5) < 0.02
    )
    low, high = row["returnRange"]["low"], row["returnRange"]["high"]
    assert (
        row["returnRange"]["basis"] == "beta_ci90"
        and low < row["portfolioReturn"] < high < 0
    )
    # Portfolio beta equals the value-weighted betas (OLS is linear); cash has beta 0.
    weighted = (600 * stock["beta"] + 400 * us["beta"]) / 1100
    assert row["portfolioReturn"] == pytest.approx(weighted * -0.3, abs=2e-6)
    assert {"LINEAR_SINGLE_FACTOR"} <= set(codes(output))
    assert output["assumptions"]["betaWindowMonths"] == 60


def test_regression_matches_numpy_polyfit() -> None:
    rng = np.random.default_rng(3)
    f = rng.normal(0, 0.05, 60)
    y = 0.7 * f + rng.normal(0, 0.01, 60)
    fit = regress(y, f)
    assert fit is not None
    slope, _ = np.polyfit(f, y, 1)
    assert fit.beta == pytest.approx(slope, rel=1e-12)
    assert fit.high - fit.beta == pytest.approx(fit.beta - fit.low)
    assert regress(y, np.zeros(60)) is None


def test_fx_shock_reports_the_translation_effect() -> None:
    shock = {"kind": "fx_shock", "currency": "USD", "shock": 0.1}
    row = run_stress_test(
        job(historical=[], hypothetical=[shock]), data(monthly=monthly())
    )["result"]["scenarios"][0]
    assert row["status"] == "ok" and row["shockCurrency"] == "USD"
    assert row["translationReturn"] == round(400 / 1100 * 0.1, 6)
    assert (
        row["returnRange"]["low"]
        <= row["portfolioReturn"]
        <= row["returnRange"]["high"]
    )


def test_correlation_shock_is_a_one_month_band_led_by_the_left_tail() -> None:
    shocks = [{"kind": "correlation_shock", "correlation": 1.0}]
    source = monthly()
    row = run_stress_test(
        job(historical=[], hypothetical=shocks), data(monthly=source)
    )["result"]["scenarios"][0]
    stock, us = row["positions"]
    # ρ = 1: σ_p is the value-weighted sum of σ_i.
    sd = (600 * stock["volatility"] + 400 * us["volatility"]) / 1100
    assert row["portfolioReturn"] == pytest.approx(-Z90 * sd, abs=2e-6)
    assert row["returnRange"] == {
        "low": row["portfolioReturn"],
        "high": -row["portfolioReturn"],
        "basis": "one_month_p5_p95",
    }
    assert row["baselineRange"]["low"] >= row["returnRange"]["low"]  # historical ρ < 1
    assert stock["returnRatio"] == round(-Z90 * stock["volatility"], 6)


def test_missing_factor_history_is_insufficient_data() -> None:
    source = monthly()
    del source["closes"][WIG]["2021-03"]
    shock = {"kind": "index_shock", "instrumentId": WIG, "shock": -0.3}
    with pytest.raises(NoScenarioData):
        run_stress_test(job(historical=[], hypothetical=[shock]), data(monthly=source))
    mixed = run_stress_test(job(hypothetical=[shock]), data(monthly=source))
    assert [s["status"] for s in mixed["result"]["scenarios"]] == [
        "ok",
        "insufficient_data",
    ]


def test_same_inputs_same_result() -> None:
    shocks = [
        {"kind": "index_shock", "instrumentId": WIG, "shock": -0.2},
        {"kind": "correlation_shock", "correlation": 0.9},
    ]
    first = run_stress_test(job(hypothetical=shocks), data(monthly=monthly()))
    assert first == run_stress_test(
        job(hypothetical=shocks), copy.deepcopy(data(monthly=monthly()))
    )
