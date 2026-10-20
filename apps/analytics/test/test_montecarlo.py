"""Monte Carlo (BL-313, § 12.1) on synthetic data: distribution only, reproducible, bounded."""

import copy
import time
from typing import Any

import numpy as np
import pytest

from oliginvest_analytics.contracts import check_result
from oliginvest_analytics.montecarlo import (
    MIN_HISTORY_MONTHS,
    InsufficientData,
    MarketInputs,
    bootstrap_indices,
    flow_schedule,
    run_monte_carlo,
    simulate,
)

WIG = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01"
SPX = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d02"
RUN = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e"


def months(count: int) -> list[str]:
    return [f"{2000 + (i // 12)}-{i % 12 + 1:02d}" for i in range(count)]


def inputs(count: int = 300, cash_rate: float | None = 0.0575) -> MarketInputs:
    rng = np.random.default_rng(1)
    return MarketInputs(
        months=months(count),
        returns={
            WIG: list(rng.normal(0.006, 0.05, count)),
            SPX: list(rng.normal(0.007, 0.045, count)),
        },
        cash_rate=cash_rate,
        cash_rate_date="2025-07-03" if cash_rate is not None else None,
        data_version={WIG: "2000-01..2024-12", SPX: "2000-01..2024-12"},
        tickers={WIG: "WIG", SPX: "^GSPC"},
    )


def job(**params: Any) -> dict[str, Any]:
    base = {
        "horizonYears": 10,
        "paths": 2000,
        "model": "stationary_bootstrap",
        "meanBlockMonths": 6,
        "historyWindow": "full",
        "contributions": [],
        "withdrawals": [],
        "inflationRate": 0.025,
        "taxMode": "none",
    }
    return {
        "v": 1,
        "runId": RUN,
        "type": "monte_carlo",
        "requestedAt": "2026-10-20T10:00:00Z",
        "params": {**base, **params},
        "portfolio": {
            "asOf": "2026-10-19",
            "positions": [
                {
                    "instrumentId": WIG,
                    "proxyInstrumentId": WIG,
                    "value": {"amount": "60000.00", "currency": "PLN"},
                },
                {
                    "instrumentId": SPX,
                    "proxyInstrumentId": SPX,
                    "value": {"amount": "30000.00", "currency": "PLN"},
                },
            ],
            "cash": {"amount": "10000.00", "currency": "PLN"},
        },
        "seed": 42,
    }


def envelope(output: dict[str, Any]) -> dict[str, Any]:
    return {
        "v": 1,
        "runId": RUN,
        "status": "done",
        "finishedAt": "2026-10-20T10:00:05Z",
        "durationMs": 5000,
        **output,
    }


def test_result_is_a_distribution_that_passes_the_result_contract() -> None:
    output = run_monte_carlo(
        job(goal={"amount": "150000", "currency": "PLN"}), inputs()
    )
    assert check_result(envelope(output))
    result = output["result"]
    assert set(result) == {
        "kind",
        "currency",
        "months",
        "nominal",
        "real",
        "goalProbability",
        "maxDrawdownPercentiles",
        "sensitivity",
    }
    assert result["months"] == list(range(121))
    for fan in (result["nominal"], result["real"]):
        bands = np.array([fan[k] for k in ("p5", "p25", "p50", "p75", "p95")])
        assert bands.shape == (5, 121)
        assert np.all(np.diff(bands, axis=0) >= 0), "left tail first, bands ordered"
        assert np.allclose(bands[:, 0], 100000)
    # Real values are deflated by inflation; spread grows with the horizon.
    assert result["real"]["p50"][-1] < result["nominal"]["p50"][-1]
    assert result["nominal"]["p95"][-1] - result["nominal"]["p5"][-1] > 0
    assert 0 <= result["goalProbability"] <= 1
    dd = result["maxDrawdownPercentiles"]
    assert -1 <= dd["p5"] <= dd["p50"] <= dd["p95"] <= 0


def test_same_seed_gives_identical_results_and_another_seed_differs() -> None:
    first = run_monte_carlo(job(), inputs())
    assert run_monte_carlo(job(), inputs()) == first  # NFR-08.05
    other = job()
    other["seed"] = 43
    assert run_monte_carlo(other, inputs())["result"] != first["result"]
    assert first["reproducibility"]["seed"] == 42
    assert first["reproducibility"]["algorithmVersion"] == "mc-1.0.0"
    assert set(first["reproducibility"]["libraries"]) == {"numpy", "python"}


def test_sensitivity_table_is_mandatory_and_monotonic_in_the_mean() -> None:
    output = run_monte_carlo(job(), inputs())
    rows = {row["scenario"]: row for row in output["result"]["sensitivity"]}
    assert set(rows) == {"mean_minus_2pp", "mean_plus_2pp", "last_10y", "full_history"}
    base = output["result"]["nominal"]["p50"][-1]
    assert (
        rows["mean_minus_2pp"]["endValueP50"]
        < base
        < rows["mean_plus_2pp"]["endValueP50"]
    )
    # Common random numbers: the full-history row equals the main run when window = full.
    assert rows["full_history"]["endValueP50"] == pytest.approx(base, abs=0.01)
    # Short history keeps only the mean shifts and warns.
    short = run_monte_carlo(job(), inputs(100))
    assert [r["scenario"] for r in short["result"]["sensitivity"]] == [
        "mean_minus_2pp",
        "mean_plus_2pp",
    ]
    assert [w["code"] for w in short["warnings"]] == [
        "COSTS_NOT_MODELLED",
        "CONCENTRATION_NOT_MODELLED",
        "SHORT_HISTORY",
    ]


def test_minimum_history_and_empty_portfolios_are_insufficient_data() -> None:
    with pytest.raises(InsufficientData):
        run_monte_carlo(job(), inputs(MIN_HISTORY_MONTHS - 1))
    empty = job()
    for position in empty["portfolio"]["positions"]:
        position["value"]["amount"] = "0"
    with pytest.raises(InsufficientData):
        run_monte_carlo(empty, inputs())


def test_assumptions_name_model_window_costs_tax_and_cash_rate() -> None:
    output = run_monte_carlo(
        job(model="parametric_t", taxMode="belka_simplified"), inputs()
    )
    a = output["assumptions"]
    assert a["model"] == "parametric_t" and a["degreesOfFreedom"] == 5
    assert "meanBlockMonths" not in a
    assert (a["historyFrom"], a["historyTo"], a["historyMonths"]) == (
        "2000-01",
        "2024-12",
        300,
    )
    assert (
        a["costs"] == "none" and a["taxRate"] == 0.19 and a["taxBasis"] == "start_value"
    )
    assert a["cashRateAnnual"] == 0.0575 and a["cashShare"] == 0.1
    assert a["proxyWeights"] == {WIG: pytest.approx(2 / 3), SPX: pytest.approx(1 / 3)}
    assert check_result(envelope(output))


def test_missing_risk_free_rate_is_an_explicit_warning_not_a_silent_zero() -> None:
    output = run_monte_carlo(job(), inputs(cash_rate=None))
    assert "RISK_FREE_MISSING" in [w["code"] for w in output["warnings"]]
    assert "cashRateAnnual" not in output["assumptions"]


def test_contributions_raise_and_withdrawals_with_tax_lower_the_distribution() -> None:
    flow = {
        "amount": {"amount": "1000", "currency": "PLN"},
        "frequency": "monthly",
        "startYear": 0,
        "endYear": 10,
        "indexToInflation": True,
    }
    base = run_monte_carlo(job(), inputs())["result"]["nominal"]["p50"][-1]
    saving = run_monte_carlo(job(contributions=[flow]), inputs())["result"]["nominal"][
        "p50"
    ][-1]
    assert saving > base + 120 * 1000
    small = {**flow, "amount": {"amount": "300", "currency": "PLN"}}
    untaxed = run_monte_carlo(job(withdrawals=[small]), inputs())
    taxed = run_monte_carlo(
        job(withdrawals=[small], taxMode="belka_simplified"), inputs()
    )
    assert (
        taxed["result"]["nominal"]["p50"][-1] < untaxed["result"]["nominal"]["p50"][-1]
    )
    big = {**flow, "amount": {"amount": "5000", "currency": "PLN"}}
    depleted = run_monte_carlo(job(withdrawals=[big]), inputs())
    assert "SEQUENCE_RISK" in [w["code"] for w in depleted["warnings"]]
    assert min(depleted["result"]["nominal"]["p5"]) >= 0, "values never go below zero"


def test_flow_schedule_follows_years_frequency_and_inflation() -> None:
    plan = {
        "amount": {"amount": "100", "currency": "PLN"},
        "frequency": "quarterly",
        "startYear": 1,
        "endYear": 2,
        "indexToInflation": True,
    }
    flows = flow_schedule([plan], 36, 0.1)
    assert np.flatnonzero(flows).tolist() == [12, 15, 18, 21]
    assert flows[12] == pytest.approx(100 * 1.1)
    yearly = {
        **plan,
        "frequency": "yearly",
        "startYear": 0,
        "endYear": 3,
        "indexToInflation": False,
    }
    assert np.flatnonzero(flow_schedule([yearly], 36, 0.1)).tolist() == [0, 12, 24]


def test_stationary_bootstrap_blocks_have_the_requested_mean_length() -> None:
    rng = np.random.default_rng(7)
    index = bootstrap_indices(rng, 240, 4000, 120, 6)
    assert index.min() >= 0 and index.max() < 240
    continued = (index[:, 1:] == (index[:, :-1] + 1) % 240).mean()
    # Continuation probability 1 − 1/6 plus chance restarts on the next date.
    assert continued == pytest.approx(5 / 6, abs=0.01)


def test_simulation_drawdown_ignores_flows_and_tax_basis_starts_today() -> None:
    risky = np.array([[0.1, -0.5, 0.2]])
    sim = simulate(
        risky,
        start_value=100.0,
        cash_share=0.0,
        cash_monthly=0.0,
        contributions=np.array([0.0, 1000.0, 0.0]),
        withdrawals=np.zeros(3),
        tax=True,
    )
    assert sim.max_drawdown[0] == pytest.approx(-0.5)
    assert sim.values[0].tolist() == pytest.approx([100.0, 110.0, 555.0, 666.0])
    # Liquidation tax only on the gain above contributions + start value: 666 − 1100 < 0.
    assert sim.liquidation[0] == pytest.approx(666.0)


def test_inputs_are_not_mutated_and_no_point_forecast_field_exists() -> None:
    original = job()
    snapshot = copy.deepcopy(original)
    output = run_monte_carlo(original, inputs())
    assert original == snapshot
    flat = repr(output).lower()
    for forbidden in ("expected", "forecast", "prognoza", "target_price"):
        assert forbidden not in flat


@pytest.mark.parametrize("model", ["stationary_bootstrap", "parametric_t"])
def test_ten_thousand_paths_over_thirty_years_fit_the_budget(model: str) -> None:
    # Roadmap M3 exit criterion 2: 10 000 paths × 30 years < 20 s on the server.
    started = time.monotonic()
    output = run_monte_carlo(job(horizonYears=30, paths=10000, model=model), inputs())
    assert time.monotonic() - started < 20
    assert len(output["result"]["months"]) == 361


def test_review_findings_are_disclosed_costs_concentration_and_dividends() -> None:
    # BL-318: costs are not modelled, proxies hide single-instrument risk, ^GSPC has no dividends.
    output = run_monte_carlo(job(), inputs())
    codes = {w["code"]: w["severity"] for w in output["warnings"]}
    assert codes["COSTS_NOT_MODELLED"] == "info"
    assert codes["CONCENTRATION_NOT_MODELLED"] == "warning"
    a = output["assumptions"]
    assert a["proxySeries"] == {WIG: "WIG", SPX: "^GSPC"}
    assert a["proxyReturnType"] == {WIG: "total_return", SPX: "price"}
    spread = job()
    spread["portfolio"]["positions"] = [
        {
            "instrumentId": f"0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5e{n:02d}",
            "proxyInstrumentId": WIG if n % 2 else SPX,
            "value": {"amount": "9000.00", "currency": "PLN"},
        }
        for n in range(10)
    ]
    diversified = run_monte_carlo(spread, inputs())
    assert "CONCENTRATION_NOT_MODELLED" not in [
        w["code"] for w in diversified["warnings"]
    ]
