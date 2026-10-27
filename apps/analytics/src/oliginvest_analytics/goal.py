"""Goal calculator: required monthly contribution for P(value ≥ target) ≥ p (§ 12.6, BL-560).

The Monte Carlo of § 12.1 (stationary bootstrap, same proxies, costs and simplified tax) with one
monthly contribution plan. Without withdrawals the terminal value of a path is linear in the
contribution c on common random numbers: V(c) = A + c·B, and the value after the simplified tax is
min(V, 0.81·V + 0.19·(S + c·K)) — both branches increase with c. Each path therefore has an exact
minimal contribution, and the requirement for p is their p-quantile: the limit of the binary search
of § 12.6 on the same paths, without its tolerance. The result is a set of quantiles with a
sensitivity table — never a promise.
"""

import math
import platform
from collections.abc import Mapping, Sequence
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Any

import numpy as np

from .montecarlo import (
    BELKA,
    SENSITIVITY_SHIFT,
    WINDOW_10Y_MONTHS,
    Array,
    MarketInputs,
    Progress,
    _amount,
    _risky_paths,
    common_warnings,
    cost_warning,
    flow_schedule,
    portfolio_series,
    proxy_assumptions,
    sensitivity_blocks,
    simulate,
)

ALGORITHM_VERSION = "goal-1.0.0"
MODEL = "stationary_bootstrap"
MEAN_BLOCK_MONTHS = 6  # algorithm constant (§ 12.6), shown in the assumptions
MAX_CONTRIBUTION = (
    Decimal(10) ** 12
)  # above this the model answers null, never a number
CENT = Decimal("0.01")


def path_requirements(
    a: Array, b: Array, *, start: float, units: float, target: float, tax: bool
) -> Array:
    """Minimal contribution per path: smallest c with value-after-tax(c) ≥ target (≥ 0).

    a — terminal value without contributions, b — terminal value of the unit contribution stream,
    start — today's value (tax basis), units — nominal sum of the unit stream (basis per unit)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        need = np.where(b > 0, (target - a) / b, np.where(a >= target, 0.0, np.inf))
        if tax:
            slope = (1 - BELKA) * b + BELKA * units
            after_tax = (target - (1 - BELKA) * a - BELKA * start) / slope
            need = np.maximum(need, np.where(slope > 0, after_tax, np.inf))
    required: Array = np.maximum(need, 0.0)
    return required


def quantile_requirement(required: Array, probability: float) -> float:
    """Smallest c such that at least `probability` of the paths have required ≤ c."""
    ordered = np.sort(required)
    # Exact ceil(p·n) for p ∈ {0.5, 0.75, 0.9}: no float rounding of the rank.
    rank = math.ceil(Decimal(str(probability)) * ordered.size)
    return float(ordered[max(rank, 1) - 1])


def contribution_money(value: float) -> dict[str, str] | None:
    """Rounded up to the grosz so the stated amount meets p in the model; null when out of range."""
    if not math.isfinite(value):
        return None
    amount = Decimal(repr(max(value, 0.0))).quantize(CENT, rounding=ROUND_CEILING)
    if amount > MAX_CONTRIBUTION:
        return None
    return {"amount": f"{amount:.2f}", "currency": "PLN"}


def run_goal(
    job: Mapping[str, Any], inputs: MarketInputs, progress: Progress | None = None
) -> dict[str, Any]:
    report = progress or (lambda _p, _s: None)
    params, portfolio = job["params"], job["portfolio"]
    seed = int(job["seed"])
    years = int(params["horizonYears"])
    months_total = years * 12
    mix = portfolio_series(portfolio, inputs)
    inflation = float(params["inflationRate"])
    tax = params["taxMode"] == "belka_simplified"
    annual_cost = float(params["annualCostRate"])
    target_amount = _amount(params["target"])
    target = float(target_amount)
    probabilities: Sequence[float] = sorted(float(p) for p in params["probabilities"])
    unit_plan = {
        "amount": {"amount": "1", "currency": "PLN"},
        "frequency": "monthly",
        "startYear": 0,
        "endYear": years,
        "indexToInflation": bool(params["indexToInflation"]),
    }
    unit = flow_schedule([unit_plan], months_total, inflation)
    none = np.zeros(months_total)
    start = float(mix.total)

    def requirements(series: Array, mean_block: int = MEAN_BLOCK_MONTHS) -> list[float]:
        risky = _risky_paths(
            MODEL, series, int(params["paths"]), months_total, mean_block, seed
        )

        def terminal(start_value: float, contributions: Array) -> Array:
            simulation = simulate(
                risky,
                start_value=start_value,
                cash_share=mix.cash_share,
                cash_monthly=mix.cash_monthly,
                contributions=contributions,
                withdrawals=none,
                tax=False,
                annual_cost=annual_cost,
            )
            values: Array = simulation.values[:, -1]
            return values

        required = path_requirements(
            terminal(start, none),
            terminal(0.0, unit),
            start=start,
            units=float(unit.sum()),
            target=target,
            tax=tax,
        )
        return [quantile_requirement(required, p) for p in probabilities]

    def rows(values: list[float]) -> list[dict[str, Any]]:
        return [
            {"probability": p, "monthlyContribution": contribution_money(v)}
            for p, v in zip(probabilities, values, strict=True)
        ]

    report(10, "simulating")
    full = mix.full
    main = requirements(full)
    report(60, "sensitivity")
    shift = SENSITIVITY_SHIFT / 12
    sensitivity: list[dict[str, Any]] = [
        {
            "scenario": "mean_minus_2pp",
            "requirements": rows(requirements(full - shift)),
        },
        {"scenario": "mean_plus_2pp", "requirements": rows(requirements(full + shift))},
    ]
    history = full.size
    if history > WINDOW_10Y_MONTHS:
        sensitivity += [
            {
                "scenario": "last_10y",
                "requirements": rows(requirements(full[-WINDOW_10Y_MONTHS:])),
            },
            {"scenario": "full_history", "requirements": rows(main)},
        ]
    block_lengths = sensitivity_blocks(MEAN_BLOCK_MONTHS)
    sensitivity += [
        {
            "scenario": "block_length",
            "meanBlockMonths": length,
            "requirements": rows(requirements(full, length)),
        }
        for length in block_lengths
    ]
    report(90, "summarizing")

    main_rows = [
        {**row, "alreadyMet": value <= 0}
        for row, value in zip(rows(main), main, strict=True)
    ]
    deflator = (1 + Decimal(repr(inflation))) ** years
    real = (target_amount / deflator).quantize(CENT, rounding=ROUND_HALF_UP)
    result = {
        "kind": "goal",
        "target": {"amount": params["target"]["amount"], "currency": "PLN"},
        "targetReal": {"amount": f"{max(real, CENT):.2f}", "currency": "PLN"},
        "horizonYears": years,
        "requirements": main_rows,
        "sensitivity": sensitivity,
    }
    warnings: list[dict[str, str]] = [
        cost_warning(annual_cost),
        {
            "code": "MODEL_PROBABILITY",
            "severity": "info",
            "message": "Prawdopodobieństwa dotyczą scenariuszy modelu opartego na historii proxy; "
            "nie są gwarancją. Sprawdź tabelę wrażliwości.",
        },
        *common_warnings(portfolio, inputs, mix),
    ]
    if any(
        row["monthlyContribution"] is None
        for row in [*main_rows, *(r for s in sensitivity for r in s["requirements"])]
    ):
        warnings.append(
            {
                "code": "GOAL_OUT_OF_RANGE",
                "severity": "warning",
                "message": "Dla części poziomów prawdopodobieństwa model nie wyznacza wpłaty "
                "w rozsądnym zakresie (brak wartości).",
            }
        )
    assumptions: dict[str, Any] = {
        "model": MODEL,
        "meanBlockMonths": MEAN_BLOCK_MONTHS,
        "sensitivityBlockMonths": block_lengths,
        "historyWindow": "full",
        "historyFrom": inputs.months[0],
        "historyTo": inputs.months[-1],
        "historyMonths": history,
        "paths": params["paths"],
        "horizonYears": years,
        "step": "month",
        "rebalancing": "monthly_constant_mix",
        "returnsCurrency": "PLN (NBP table A, month end)",
        "proxyWeights": {proxy: round(w, 6) for proxy, w in mix.weights.items()},
        "cashShare": round(mix.cash_share, 6),
        "cashRateAnnual": inputs.cash_rate,
        "cashRateSource": "NBP:REF_RATE",
        "cashRateDate": inputs.cash_rate_date,
        "inflationRate": inflation,
        "contributionTiming": "start_of_month",
        "contributionIndexation": "inflation" if params["indexToInflation"] else "none",
        "contributionReported": "first_month",
        "taxMode": params["taxMode"],
        "taxRate": BELKA if tax else 0,
        "taxBasis": "start_value_plus_contributions" if tax else None,
        "annualCostRate": annual_cost,
        "annualCostApplication": "value_deduction_every_12_months",
        "transactionCosts": "none",
        **proxy_assumptions(inputs, mix.weights),
        "sensitivityShiftAnnual": SENSITIVITY_SHIFT,
        "goalBasis": "after_simplified_tax" if tax else "market_value",
        "targetBasis": "nominal",
        "searchMethod": "exact_quantile_common_random_numbers",
        "contributionRounding": "ceiling_to_grosz",
    }
    return {
        "result": result,
        "assumptions": {k: v for k, v in assumptions.items() if v is not None},
        "warnings": warnings,
        "reproducibility": {
            "seed": seed,
            "algorithmVersion": ALGORITHM_VERSION,
            "dataVersion": dict(inputs.data_version),
            "libraries": {"numpy": np.__version__, "python": platform.python_version()},
        },
    }
