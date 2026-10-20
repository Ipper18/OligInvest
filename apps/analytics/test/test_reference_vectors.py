"""BL-317: vectors B–D against empyrical-reloaded (obliczenia-finansowe.md § 0.5).

Each value must round to the vector (half a unit of its last digit) and meet the
§ 0.5 tolerance against the reference. Where empyrical has no function (XIRR,
correlation, parametric VaR) numpy/scipy compute the § 6–8 definition directly.
"""

from datetime import date
from decimal import Decimal, localcontext
from itertools import pairwise
from typing import Any

import empyrical
import numpy as np
import pytest
from scipy import optimize, stats

from oliginvest_analytics.vectors import (
    TOLERANCES,
    load_test_vectors,
    read_decimal_text,
    read_statistic,
)

VECTORS = load_test_vectors()
B: dict[str, Any] = VECTORS["B_twr_xirr"]
C: dict[str, Any] = VECTORS["C_drawdown"]
D: dict[str, Any] = VECTORS["D_risk"]
RISK = float(TOLERANCES["riskMetrics"])
RETURNS = float(TOLERANCES["returnsRelative"])
XIRR = float(TOLERANCES["xirrAbsolute"])
PERIODS = 252


def half_unit(value: object) -> float:
    """Half a unit of the last digit printed in the JSON vector."""
    text = repr(read_statistic(value))
    places = len(text.split(".")[1]) if "." in text else 0
    return 0.5 * 10.0**-places


def assert_vector(actual: float, expected: object, tolerance: float = RISK) -> None:
    limit = min(tolerance, half_unit(expected)) + 1e-15
    assert abs(actual - read_statistic(expected)) <= limit


def percent(text: str) -> tuple[Decimal, Decimal]:
    """ "10.982739%" → exact fraction and half a unit of its last digit."""
    digits = text.removesuffix("%")
    places = len(digits.split(".")[1]) if "." in digits else 0
    return Decimal(digits) / 100, Decimal("0.5") * Decimal(10) ** -(places + 2)


def assert_percent(actual: float | Decimal, text: str) -> None:
    value, half = percent(text)
    assert abs(Decimal(str(actual)) - value) <= half


# --- B: TWR (chain) and XIRR -------------------------------------------------------

# § 6.4 table: value before the flow and the flow; the JSON keeps flows and the end.
B_TABLE = [
    ("2025-01-01", "0", "10000"),
    ("2025-04-01", "10800", "5000"),
    ("2025-07-01", "15200", "-2000"),
    ("2025-12-31", "14100", None),
]


def b_subperiod_returns() -> list[Decimal]:
    # § 6.2: r_d = V_d / (V_{d-1} + F_{d-1}) − 1, flows booked at the start of the period.
    with localcontext(prec=34):
        return [
            Decimal(value) / (Decimal(previous_value) + Decimal(flow)) - 1
            for (_, previous_value, flow), (_, value, _) in pairwise(B_TABLE)
        ]


def test_b_table_matches_vector_cash_flows() -> None:
    vector = [
        (day, Decimal(read_decimal_text(amount)))
        for day, amount in B["cashflows_investor_view"]
    ]
    # Investor view: deposits negative, withdrawals positive, final value positive.
    table = [(day, -Decimal(flow)) for day, _, flow in B_TABLE if flow is not None]
    assert vector == [*table, (B_TABLE[-1][0], Decimal(B_TABLE[-1][1]))]
    start, end = date.fromisoformat(B_TABLE[0][0]), date.fromisoformat(B_TABLE[-1][0])
    assert (end - start).days == B["days"]


def test_b_twr_chain_against_empyrical() -> None:
    exact = b_subperiod_returns()
    for value, text in zip(exact, B["subperiod_returns"], strict=True):
        assert_percent(value, text)
    with localcontext(prec=34):
        twr = Decimal(1)
        for value in exact:
            twr *= 1 + value
        twr -= 1
    returns = np.array([float(value) for value in exact])
    reference = float(empyrical.cum_returns_final(returns))
    assert abs(reference - float(twr)) <= RETURNS * abs(float(twr))
    assert_percent(reference, B["twr"])
    # (1 + TWR)^(365/days) − 1 expressed as empyrical's CAGR over the three periods.
    annualized = float(
        empyrical.annual_return(returns, annualization=len(returns) * 365 / B["days"])
    )
    expected = (1 + float(twr)) ** (365 / B["days"]) - 1
    assert abs(annualized - expected) <= RETURNS * abs(expected)
    assert_percent(annualized, B["twr_annualized_365"])


def test_b_xirr_solves_the_act365_equation() -> None:
    # empyrical has no XIRR: brentq solves § 6.3 on the vector's cash flows.
    flows = [
        (date.fromisoformat(day), float(read_decimal_text(amount)))
        for day, amount in B["cashflows_investor_view"]
    ]
    start = flows[0][0]
    scale = max(abs(amount) for _, amount in flows)

    def npv(rate: float) -> float:
        return sum(
            amount / scale / (1 + rate) ** ((day - start).days / 365)
            for day, amount in flows
        )

    rate = optimize.brentq(npv, -0.9999, 10, xtol=1e-14)
    expected, half = percent(B["xirr"])
    assert abs(rate - float(expected)) <= XIRR
    assert abs(Decimal(str(rate)) - expected) <= half


# --- C: drawdown ----------------------------------------------------------------------


def test_c_drawdown_against_empyrical() -> None:
    values = np.array([read_statistic(value) for value in C["values"]], dtype=float)
    returns = values[1:] / values[:-1] - 1
    maximum = float(empyrical.max_drawdown(returns))
    assert_vector(maximum, C["max_drawdown"])
    assert_vector(maximum, C["empyrical_max_drawdown"])
    index = np.concatenate(
        (
            [values[0]],
            np.asarray(empyrical.cum_returns(returns, starting_value=values[0])),
        )
    )
    series = index / np.maximum.accumulate(index) - 1
    for actual, expected in zip(series, C["drawdown_series"], strict=True):
        assert_vector(float(actual), expected)
    trough = int(np.argmin(series))
    peak = int(np.argmax(index[: trough + 1]))
    recovery = next(i for i in range(trough, len(index)) if index[i] >= index[peak])
    assert (peak, trough, recovery) == (
        C["peak_index"],
        C["trough_index"],
        C["recovery_index"],
    )


# --- D: risk metrics -----------------------------------------------------------------

R = np.array([read_statistic(value) for value in D["returns"]], dtype=float)
BENCH = np.array([read_statistic(value) for value in D["benchmark"]], dtype=float)
TIED = np.array([read_statistic(value) for value in D["tied_returns"]], dtype=float)
RF_DAILY = (1 + read_statistic(D["rf_annual"])) ** (1 / PERIODS) - 1


def sortino_definition(returns: np.ndarray) -> float:
    # § 8: downside deviation over all observations, MAR = 0.
    downside = np.sqrt(np.mean(np.minimum(returns, 0) ** 2))
    return float(np.mean(returns) * PERIODS / (downside * np.sqrt(PERIODS)))


def cvar_definition(returns: np.ndarray) -> float:
    # § 8: mean of the k = ⌊(n − 1)·0.05⌋ + 1 lowest returns (owner decision C-23).
    k = int((len(returns) - 1) * 0.05) + 1
    return float(-np.mean(np.sort(returns)[:k]))


@pytest.mark.parametrize(
    ("keys", "reference", "definition"),
    [
        (("mean_daily",), float(np.mean(R)), None),
        (("stdev_daily_sample",), float(np.std(R, ddof=1)), None),
        (
            ("volatility_annual", "empyrical_annual_volatility"),
            float(empyrical.annual_volatility(R)),
            float(np.std(R, ddof=1) * np.sqrt(PERIODS)),
        ),
        (
            ("sharpe_rf0", "empyrical_sharpe_rf0"),
            float(empyrical.sharpe_ratio(R, risk_free=0)),
            float(np.mean(R) / np.std(R, ddof=1) * np.sqrt(PERIODS)),
        ),
        (("rf_daily",), RF_DAILY, None),
        (
            ("sharpe_rf5pct", "empyrical_sharpe_rf5pct"),
            float(empyrical.sharpe_ratio(R, risk_free=RF_DAILY)),
            float(
                np.mean(R - RF_DAILY) / np.std(R - RF_DAILY, ddof=1) * np.sqrt(PERIODS)
            ),
        ),
        (
            ("sortino_mar0", "empyrical_sortino_mar0"),
            float(empyrical.sortino_ratio(R, required_return=0)),
            sortino_definition(R),
        ),
        (
            ("beta", "empyrical_beta"),
            float(empyrical.beta(R, BENCH)),
            float(np.cov(R, BENCH, ddof=1)[0, 1] / np.var(BENCH, ddof=1)),
        ),
        (("correlation",), float(np.corrcoef(R, BENCH)[0, 1]), None),
        (
            ("var95_historical_1d", "empyrical_var95"),
            -float(empyrical.value_at_risk(R, cutoff=0.05)),
            -float(np.percentile(R, 5)),
        ),
        (
            ("cvar95_historical_1d", "empyrical_cvar95"),
            -float(empyrical.conditional_value_at_risk(R, cutoff=0.05)),
            cvar_definition(R),
        ),
        (
            ("var95_parametric_1d",),
            -float(np.mean(R) - stats.norm.ppf(0.95) * np.std(R, ddof=1)),
            None,
        ),
        (
            ("tied_var95_historical_1d",),
            -float(empyrical.value_at_risk(TIED, cutoff=0.05)),
            -float(np.percentile(TIED, 5)),
        ),
        (
            ("tied_cvar95_historical_1d",),
            -float(empyrical.conditional_value_at_risk(TIED, cutoff=0.05)),
            cvar_definition(TIED),
        ),
    ],
    ids=lambda value: value[0] if isinstance(value, tuple) else None,
)
def test_d_risk_against_empyrical(
    keys: tuple[str, ...], reference: float, definition: float | None
) -> None:
    for key in keys:
        assert_vector(reference, D[key])
    if definition is not None:
        # The library implements exactly the § 8 definition, not a variant.
        assert abs(reference - definition) <= RISK * max(1.0, abs(definition))
