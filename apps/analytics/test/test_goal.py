"""Goal calculator (BL-560, § 12.6): exact quantile = binary search on common random numbers."""

from decimal import Decimal
from typing import Any

import numpy as np
import pytest

from oliginvest_analytics.contracts import check_result
from oliginvest_analytics.goal import (
    MEAN_BLOCK_MONTHS,
    MODEL,
    path_requirements,
    quantile_requirement,
    run_goal,
)
from oliginvest_analytics.montecarlo import (
    MarketInputs,
    _risky_paths,
    flow_schedule,
    portfolio_series,
    simulate,
)

WIG = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d01"
SPX = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d02"
RUN = "0192f0c4-7b1e-7c3a-9f00-3d2a1b4c5d6e"


def inputs(count: int = 300) -> MarketInputs:
    rng = np.random.default_rng(1)
    return MarketInputs(
        months=[f"{2000 + (i // 12)}-{i % 12 + 1:02d}" for i in range(count)],
        returns={
            WIG: list(rng.normal(0.006, 0.05, count)),
            SPX: list(rng.normal(0.007, 0.045, count)),
        },
        cash_rate=0.0575,
        cash_rate_date="2025-07-03",
        data_version={WIG: "2000-01..2024-12", SPX: "2000-01..2024-12"},
        tickers={WIG: "WIG", SPX: "^SP500TR"},
    )


def job(**params: Any) -> dict[str, Any]:
    base = {
        "target": {"amount": "300000.00", "currency": "PLN"},
        "horizonYears": 10,
        "probabilities": [0.9, 0.5, 0.75],
        "paths": 2000,
        "inflationRate": 0.025,
        "indexToInflation": True,
        "taxMode": "belka_simplified",
        "annualCostRate": 0.005,
    }
    return {
        "v": 1,
        "runId": RUN,
        "type": "goal",
        "requestedAt": "2026-10-27T10:00:00Z",
        "params": {**base, **params},
        "portfolio": {
            "asOf": "2026-10-24",
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
        "seed": 11,
    }


def envelope(output: dict[str, Any]) -> dict[str, Any]:
    return {
        "v": 1,
        "runId": RUN,
        "status": "done",
        "finishedAt": "2026-10-27T10:00:05Z",
        "durationMs": 900,
        **output,
    }


def amounts(rows: list[dict[str, Any]]) -> list[Decimal]:
    return [Decimal(r["monthlyContribution"]["amount"]) for r in rows]


def probability_at(contribution: float, tax: bool, params: dict[str, Any]) -> float:
    """Full simulation (§ 12.1 machinery) with the contribution: share of paths ≥ target."""
    sample = job(**params)
    mix = portfolio_series(sample["portfolio"], inputs())
    months = sample["params"]["horizonYears"] * 12
    plan = {
        "amount": {"amount": repr(contribution), "currency": "PLN"},
        "frequency": "monthly",
        "startYear": 0,
        "endYear": sample["params"]["horizonYears"],
        "indexToInflation": sample["params"]["indexToInflation"],
    }
    risky = _risky_paths(
        MODEL,
        mix.full,
        sample["params"]["paths"],
        months,
        MEAN_BLOCK_MONTHS,
        sample["seed"],
    )
    result = simulate(
        risky,
        start_value=float(mix.total),
        cash_share=mix.cash_share,
        cash_monthly=mix.cash_monthly,
        contributions=flow_schedule([plan], months, sample["params"]["inflationRate"]),
        withdrawals=np.zeros(months),
        tax=tax,
        annual_cost=sample["params"]["annualCostRate"],
    )
    return float(
        (result.liquidation >= float(sample["params"]["target"]["amount"])).mean()
    )


@pytest.mark.parametrize("tax_mode", ["belka_simplified", "none"])
def test_requirement_is_the_limit_of_a_binary_search_on_the_same_paths(
    tax_mode: str,
) -> None:
    output = run_goal(job(taxMode=tax_mode), inputs())
    tax = tax_mode == "belka_simplified"
    for row in output["result"]["requirements"]:
        amount = float(row["monthlyContribution"]["amount"])
        assert probability_at(amount, tax, {"taxMode": tax_mode}) >= row["probability"]
        assert (
            probability_at(amount - 0.02, tax, {"taxMode": tax_mode})
            < row["probability"]
        )
    # Bisection on the full simulation lands on the same grosz (tolerance 1 grosz).
    target = output["result"]["requirements"][1]
    low, high = 0.0, 50_000.0
    while high - low > 0.001:
        middle = (low + high) / 2
        low, high = (
            (low, middle)
            if probability_at(middle, tax, {"taxMode": tax_mode})
            >= target["probability"]
            else (middle, high)
        )
    assert abs(high - float(target["monthlyContribution"]["amount"])) <= 0.011


def test_result_is_a_set_of_quantiles_with_assumptions_and_sensitivity() -> None:
    output = run_goal(job(), inputs())
    assert check_result(envelope(output))
    result = output["result"]
    assert [r["probability"] for r in result["requirements"]] == [0.5, 0.75, 0.9]
    values = amounts(result["requirements"])
    assert values == sorted(values) and values[0] > 0
    assert all(r["alreadyMet"] is False for r in result["requirements"])
    # 300 000 / 1.025^10 = 234 359.52 in today's money.
    assert result["targetReal"] == {"amount": "234359.52", "currency": "PLN"}
    rows = {(s["scenario"], s.get("meanBlockMonths")): s for s in result["sensitivity"]}
    assert set(rows) == {
        ("mean_minus_2pp", None),
        ("mean_plus_2pp", None),
        ("last_10y", None),
        ("full_history", None),
        ("block_length", 3),
        ("block_length", 12),
    }
    assert amounts(rows[("mean_minus_2pp", None)]["requirements"]) > amounts(
        rows[("mean_plus_2pp", None)]["requirements"]
    )
    assert rows[("full_history", None)]["requirements"] == [
        {k: v for k, v in r.items() if k != "alreadyMet"}
        for r in result["requirements"]
    ]
    a = output["assumptions"]
    assert (a["model"], a["meanBlockMonths"], a["sensitivityBlockMonths"]) == (
        MODEL,
        6,
        [3, 12],
    )
    assert a["taxMode"] == "belka_simplified" and a["annualCostRate"] == 0.005
    assert a["contributionIndexation"] == "inflation" and a["targetBasis"] == "nominal"
    assert a["proxySeries"] == {WIG: "WIG", SPX: "^SP500TR"}
    codes = [w["code"] for w in output["warnings"]]
    assert codes[:2] == ["TRANSACTION_COSTS_NOT_MODELLED", "MODEL_PROBABILITY"]
    assert "CONCENTRATION_NOT_MODELLED" in codes  # 60 % in one proxy position
    assert output["reproducibility"] == {
        "seed": 11,
        "algorithmVersion": "goal-1.0.0",
        "dataVersion": {WIG: "2000-01..2024-12", SPX: "2000-01..2024-12"},
        "libraries": output["reproducibility"]["libraries"],
    }


def test_same_seed_same_requirements_and_tax_raises_them() -> None:
    assert run_goal(job(), inputs()) == run_goal(job(), inputs())
    taxed = amounts(run_goal(job(), inputs())["result"]["requirements"])
    untaxed = amounts(run_goal(job(taxMode="none"), inputs())["result"]["requirements"])
    assert all(t >= u for t, u in zip(taxed, untaxed, strict=True))


def test_target_already_met_is_zero_not_missing() -> None:
    output = run_goal(job(target={"amount": "1000.00", "currency": "PLN"}), inputs())
    rows = output["result"]["requirements"]
    assert all(
        r["alreadyMet"] and r["monthlyContribution"]["amount"] == "0.00" for r in rows
    )


def test_out_of_range_target_is_null_with_a_warning() -> None:
    output = run_goal(
        job(target={"amount": "99999999999999", "currency": "PLN"}, horizonYears=1),
        inputs(),
    )
    assert all(
        r["monthlyContribution"] is None for r in output["result"]["requirements"]
    )
    assert "GOAL_OUT_OF_RANGE" in [w["code"] for w in output["warnings"]]
    assert check_result(envelope(output))


def test_path_requirements_solve_both_tax_branches() -> None:
    a, b = np.array([100.0, 50.0, 300.0]), np.array([10.0, 10.0, 10.0])
    need = path_requirements(a, b, start=100.0, units=5.0, target=200.0, tax=True)
    for c, ai, bi in zip(need, a, b, strict=True):
        value = ai + c * bi
        after_tax = min(value, 0.81 * value + 0.19 * (100.0 + c * 5.0))
        assert after_tax == pytest.approx(200.0) or (c == 0 and after_tax >= 200.0)
    assert quantile_requirement(np.array([3.0, 1.0, 2.0, 4.0]), 0.5) == 2.0
    assert quantile_requirement(np.array([3.0, 1.0, 2.0, 4.0]), 0.75) == 3.0
    assert quantile_requirement(np.arange(10, dtype=np.float64), 0.9) == 8.0
