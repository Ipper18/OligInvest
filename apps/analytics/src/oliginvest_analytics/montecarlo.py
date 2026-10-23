"""Monte Carlo of portfolio value in PLN (obliczenia-finansowe.md § 12.1, BL-313).

Pure computation without I/O: runs in the secretless child process on market data that the
parent read as `analytics_ro`. The output is a distribution only (percentile fan, probability
of the goal, drawdown percentiles, sensitivity table) with its assumptions — never a point
forecast. Statistics are float64 (§ 0.1); amounts enter as Decimal text and leave rounded.
"""

import platform
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import numpy as np
import numpy.typing as npt

ALGORITHM_VERSION = "mc-1.0.0"
NU = 5  # Student-t degrees of freedom (§ 12.1)
BELKA = 0.19
MIN_HISTORY_MONTHS = 60
SHORT_HISTORY_MONTHS = 240
WINDOW_10Y_MONTHS = 120
SENSITIVITY_SHIFT = 0.02  # ± 2 p.p. per year on the risky part
CONCENTRATION_LIMIT = (
    0.2  # proxies hide single-instrument risk above this weight (BL-318)
)
# Index return type of known proxies (BL-318): a price index omits dividends.
RETURN_TYPES = {"WIG": "total_return", "^SP500TR": "total_return", "^GSPC": "price"}
RETURN_FLOOR = -0.95  # a month cannot lose more than 95 % in the parametric model
PERCENTILES = (5, 25, 50, 75, 95)
BLOCK_CANDIDATES = (
    1,
    3,
    12,
    24,
)  # fill-ins when half or double the block is not distinct


def sensitivity_blocks(mean_block: int) -> list[int]:
    """Two other mean block lengths for the sensitivity table (owner condition 2026-10-21):
    half and double the chosen one within 1–24 months, else the nearest distinct candidates."""
    lengths: list[int] = []
    for length in (max(1, mean_block // 2), min(24, mean_block * 2), *BLOCK_CANDIDATES):
        if length != mean_block and length not in lengths:
            lengths.append(length)
        if len(lengths) == 2:
            break
    return sorted(lengths)


FREQUENCY_STEP = {"monthly": 1, "quarterly": 3, "yearly": 12}

type Array = npt.NDArray[np.float64]
type Progress = Callable[[int, str], None]


class InsufficientData(ValueError):
    """Fewer than MIN_HISTORY_MONTHS common monthly returns of the proxies."""


@dataclass(frozen=True)
class MarketInputs:
    """Monthly PLN returns of each proxy over common months (oldest first)."""

    months: Sequence[str]  # "YYYY-MM" of each return's month end
    returns: Mapping[str, Sequence[float]]  # proxy id → returns aligned to `months`
    cash_rate: float | None  # annual risk-free rate in force on the snapshot date
    cash_rate_date: str | None
    data_version: Mapping[str, str]
    tickers: Mapping[str, str] = field(default_factory=dict)  # proxy id → ticker


def _amount(value: Mapping[str, Any]) -> Decimal:
    return Decimal(str(value["amount"]))


def flow_schedule(
    plans: Sequence[Mapping[str, Any]], months: int, inflation: float
) -> Array:
    """Amounts at month m = 1..M (index m-1); year y = (m-1) // 12 is active for
    startYear ≤ y < endYear; inflation indexation from the first month."""
    flows = np.zeros(months)
    for plan in plans:
        amount = float(_amount(plan["amount"]))
        step = FREQUENCY_STEP[plan["frequency"]]
        for m in range(1, months + 1):
            year = (m - 1) // 12
            if plan["startYear"] <= year < plan["endYear"] and (m - 1) % step == 0:
                factor = (
                    (1 + inflation) ** ((m - 1) / 12) if plan["indexToInflation"] else 1
                )
                flows[m - 1] += amount * factor
    return flows


def bootstrap_indices(
    rng: np.random.Generator, history: int, paths: int, months: int, mean_block: int
) -> npt.NDArray[np.int64]:
    """Stationary bootstrap (Politis–Romano 1994): blocks of geometric length with mean
    `mean_block`, circular wrap; preserves cross-sectional correlation (rows are dates)."""
    restart = 1.0 / mean_block
    index = np.empty((paths, months), dtype=np.int64)
    index[:, 0] = rng.integers(0, history, paths)
    for t in range(1, months):
        jump = rng.random(paths) < restart
        index[:, t] = np.where(
            jump, rng.integers(0, history, paths), (index[:, t - 1] + 1) % history
        )
    return index


def _risky_paths(
    model: str,
    series: Array,
    paths: int,
    months: int,
    mean_block: int,
    seed: int,
) -> Array:
    """Monthly risky-portfolio returns per path (paths × months), common random numbers per seed."""
    rng = np.random.Generator(np.random.PCG64(seed))
    if model == "stationary_bootstrap":
        sampled: Array = series[
            bootstrap_indices(rng, series.size, paths, months, mean_block)
        ]
        return sampled
    # Portfolio of proxies with multivariate t(ν) returns is a univariate t with the portfolio
    # mean and variance; scale chosen so that the variance matches the sample variance.
    mean = float(series.mean())
    scale = float(series.std(ddof=1)) * np.sqrt((NU - 2) / NU)
    z = rng.standard_normal((paths, months))
    w = rng.chisquare(NU, (paths, months))
    drawn: Array = np.maximum(mean + scale * z * np.sqrt(NU / w), RETURN_FLOOR)
    return drawn


@dataclass(frozen=True)
class Simulation:
    values: Array  # paths × (months + 1), nominal PLN
    liquidation: Array  # terminal value after the simplified Belka tax (or equal to values[:, -1])
    max_drawdown: Array  # per path, on the flow-free return index (§ 7)
    depleted: float  # share of paths where withdrawals emptied the portfolio


def simulate(
    risky: Array,
    *,
    start_value: float,
    cash_share: float,
    cash_monthly: float,
    contributions: Array,
    withdrawals: Array,
    tax: bool,
    annual_cost: float = 0.0,
) -> Simulation:
    """Constant mix rebalanced monthly; flows at the start of the month (§ 6.2 convention).
    Withdrawals are net amounts; the simplified tax takes 19 % of the gain share of the gross
    withdrawal, the cost basis starts at today's value (§ 12.1 assumption). The annual cost
    (TER + FX conversion) is deducted from the value once a year, at the end of every 12th
    month; it lowers the return index too, so drawdowns are net of costs."""
    paths, months = risky.shape
    returns = (1 - cash_share) * risky + cash_share * cash_monthly
    values = np.empty((paths, months + 1))
    values[:, 0] = start_value
    value = np.full(paths, start_value)
    basis = np.full(paths, start_value)
    index = np.ones(paths)
    peak = np.ones(paths)
    worst = np.zeros(paths)
    depleted = np.zeros(paths, dtype=bool)
    for m in range(months):
        value = value + contributions[m]
        basis = basis + contributions[m]
        if withdrawals[m] > 0:
            positive = value > 0
            gain = np.where(
                positive, np.clip(1 - basis / np.where(positive, value, 1), 0, 1), 0
            )
            rate = BELKA * gain if tax else np.zeros(paths)
            gross = np.minimum(withdrawals[m] / (1 - rate), value)
            depleted |= gross >= value - 1e-9
            basis = np.where(
                positive, basis * (1 - gross / np.where(positive, value, 1)), 0
            )
            value = value - gross
        value = np.maximum(value * (1 + returns[:, m]), 0)
        index = index * (1 + returns[:, m])
        if annual_cost > 0 and (m + 1) % 12 == 0:
            value = value * (1 - annual_cost)
            index = index * (1 - annual_cost)
        peak = np.maximum(peak, index)
        worst = np.minimum(worst, index / peak - 1)
        values[:, m + 1] = value
    liquidation = value - BELKA * np.maximum(value - basis, 0) if tax else value.copy()
    return Simulation(values, liquidation, worst, float(depleted.mean()))


def _fan(values: Array) -> dict[str, list[float]]:
    bands = np.percentile(values, PERCENTILES, axis=0)
    return {
        f"p{p}": [round(float(v), 2) for v in band]
        for p, band in zip(PERCENTILES, bands, strict=True)
    }


def _goal_probability(liquidation: Array, goal: float | None) -> float | None:
    return None if goal is None else round(float((liquidation >= goal).mean()), 4)


def run_monte_carlo(
    job: Mapping[str, Any], inputs: MarketInputs, progress: Progress | None = None
) -> dict[str, Any]:
    report = progress or (lambda _p, _s: None)
    params, portfolio = job["params"], job["portfolio"]
    seed = int(job["seed"])
    months_total = params["horizonYears"] * 12
    history = len(inputs.months)
    if history < MIN_HISTORY_MONTHS:
        raise InsufficientData(history)

    # Weights in Decimal at the boundary, statistics in float64 (§ 0.1).
    risky_values: dict[str, Decimal] = {}
    for position in portfolio["positions"]:
        proxy = position["proxyInstrumentId"]
        risky_values[proxy] = risky_values.get(proxy, Decimal(0)) + _amount(
            position["value"]
        )
    cash = _amount(portfolio["cash"])
    risky_total = sum(risky_values.values(), Decimal(0))
    total = risky_total + cash
    if total <= 0 or risky_total <= 0:
        raise InsufficientData(0)
    weights = {
        proxy: float(value / risky_total) for proxy, value in risky_values.items()
    }
    full = np.zeros(history)
    for proxy, weight in weights.items():
        full += weight * np.asarray(inputs.returns[proxy], dtype=np.float64)
    cash_share = float(cash / total)
    cash_rate = inputs.cash_rate if inputs.cash_rate is not None else 0.0
    cash_monthly = (1 + cash_rate) ** (1 / 12) - 1

    inflation = float(params["inflationRate"])
    contributions = flow_schedule(params["contributions"], months_total, inflation)
    withdrawals = flow_schedule(params["withdrawals"], months_total, inflation)
    tax = params["taxMode"] == "belka_simplified"
    annual_cost = float(params.get("annualCostRate", 0))
    goal = float(_amount(params["goal"])) if params.get("goal") else None
    windowed = (
        full[-WINDOW_10Y_MONTHS:] if params["historyWindow"] == "last_10y" else full
    )

    def run(
        series: Array, model: str | None = None, mean_block: int | None = None
    ) -> Simulation:
        risky = _risky_paths(
            model or params["model"],
            series,
            params["paths"],
            months_total,
            mean_block or params["meanBlockMonths"],
            seed,
        )
        return simulate(
            risky,
            start_value=float(total),
            cash_share=cash_share,
            cash_monthly=cash_monthly,
            contributions=contributions,
            withdrawals=withdrawals,
            tax=tax,
            annual_cost=annual_cost,
        )

    report(10, "simulating")
    main = run(windowed)
    report(60, "sensitivity")
    shift = SENSITIVITY_SHIFT / 12
    scenarios: list[tuple[str, Simulation]] = [
        ("mean_minus_2pp", run(windowed - shift)),
        ("mean_plus_2pp", run(windowed + shift)),
    ]
    if history > WINDOW_10Y_MONTHS:
        recent = (
            main
            if params["historyWindow"] == "last_10y"
            else run(full[-WINDOW_10Y_MONTHS:])
        )
        whole = main if params["historyWindow"] == "full" else run(full)
        scenarios += [("last_10y", recent), ("full_history", whole)]
    # Block-length rows always use the stationary bootstrap (with the t model they compare models).
    block_lengths = sensitivity_blocks(params["meanBlockMonths"])
    block_rows = [
        (length, run(windowed, "stationary_bootstrap", length))
        for length in block_lengths
    ]
    report(90, "summarizing")

    month_axis = np.arange(months_total + 1)
    deflator = (1 + inflation) ** (month_axis / 12)
    result = {
        "kind": "monte_carlo",
        "currency": "PLN",
        "months": [int(m) for m in month_axis],
        "nominal": _fan(main.values),
        "real": _fan(main.values / deflator),
        "goalProbability": _goal_probability(main.liquidation, goal),
        "maxDrawdownPercentiles": {
            f"p{p}": round(float(min(0.0, max(-1.0, v))), 4)
            for p, v in zip(
                (5, 50, 95), np.percentile(main.max_drawdown, (5, 50, 95)), strict=True
            )
        },
        "sensitivity": [
            {
                "scenario": name,
                "annualCostRate": annual_cost,
                "endValueP5": round(float(np.percentile(sim.values[:, -1], 5)), 2),
                "endValueP50": round(float(np.percentile(sim.values[:, -1], 50)), 2),
                "goalProbability": _goal_probability(sim.liquidation, goal),
            }
            for name, sim in scenarios
        ]
        + [
            {
                "scenario": "block_length",
                "meanBlockMonths": length,
                "annualCostRate": annual_cost,
                "endValueP5": round(float(np.percentile(sim.values[:, -1], 5)), 2),
                "endValueP50": round(float(np.percentile(sim.values[:, -1], 50)), 2),
                "goalProbability": _goal_probability(sim.liquidation, goal),
            }
            for length, sim in block_rows
        ],
    }
    used = windowed.size
    warnings: list[dict[str, str]] = [
        {
            "code": "COSTS_NOT_MODELLED",
            "severity": "info",
            "message": "Roczny koszt ustawiono na 0 %: opłaty funduszy i przewalutowanie są "
            "pominięte, a prowizje transakcyjne są poza modelem; rzeczywiste wartości będą niższe.",
        }
        if annual_cost == 0
        else {
            "code": "TRANSACTION_COSTS_NOT_MODELLED",
            "severity": "info",
            "message": f"Roczny koszt {annual_cost:.2%} (opłaty funduszy i przewalutowanie) "
            "odejmowany raz w roku; prowizje transakcyjne są poza modelem.",
        },
        {
            "code": "CRISIS_TESTS_UNAVAILABLE",
            "severity": "info",
            "message": "Testy w okresach kryzysów (BL-556: m.in. 2008, 2020, 2022) nie są jeszcze "
            "dostępne; wynik nie pokazuje zachowania portfela w konkretnym kryzysie.",
        },
    ]
    largest = max(
        (_amount(p["value"]) / total for p in portfolio["positions"]),
        default=Decimal(0),
    )
    if largest > Decimal(str(CONCENTRATION_LIMIT)):
        warnings.append(
            {
                "code": "CONCENTRATION_NOT_MODELLED",
                "severity": "warning",
                "message": f"Największa pozycja to {float(largest):.0%} portfela; proxy indeksowe "
                "nie oddają ryzyka pojedynczego instrumentu, więc rozrzut jest niedoszacowany.",
            }
        )
    if history < SHORT_HISTORY_MONTHS:
        warnings.append(
            {
                "code": "SHORT_HISTORY",
                "severity": "warning",
                "message": f"Historia proxy obejmuje {history} miesięcy (< 20 lat); "
                "sprawdź tabelę wrażliwości.",
            }
        )
    if inputs.cash_rate is None and cash > 0:
        warnings.append(
            {
                "code": "RISK_FREE_MISSING",
                "severity": "warning",
                "message": "Brak stopy referencyjnej NBP — gotówka bez oprocentowania (założenie).",
            }
        )
    if main.depleted > 0:
        warnings.append(
            {
                "code": "SEQUENCE_RISK",
                "severity": "critical" if main.depleted >= 0.1 else "warning",
                "message": f"W {main.depleted:.1%} scenariuszy wypłaty wyczerpały portfel przed "
                "końcem horyzontu (ryzyko sekwencji).",
            }
        )
    assumptions: dict[str, Any] = {
        "model": params["model"],
        # Shown for both models (owner condition 2026-10-21); with t it feeds the block rows.
        "meanBlockMonths": params["meanBlockMonths"],
        "sensitivityBlockMonths": block_lengths,
        "sensitivityBlockModel": "stationary_bootstrap",
        "crisisTests": "unavailable (BL-556)",
        "degreesOfFreedom": NU if params["model"] == "parametric_t" else None,
        "historyWindow": params["historyWindow"],
        "historyFrom": inputs.months[-used],
        "historyTo": inputs.months[-1],
        "historyMonths": used,
        "paths": params["paths"],
        "horizonYears": params["horizonYears"],
        "step": "month",
        "rebalancing": "monthly_constant_mix",
        "returnsCurrency": "PLN (NBP table A, month end)",
        "proxyWeights": {proxy: round(weight, 6) for proxy, weight in weights.items()},
        "cashShare": round(cash_share, 6),
        "cashRateAnnual": inputs.cash_rate,
        "cashRateSource": "NBP:REF_RATE",
        "cashRateDate": inputs.cash_rate_date,
        "inflationRate": inflation,
        "taxMode": params["taxMode"],
        "taxRate": BELKA if tax else 0,
        "taxBasis": "start_value" if tax else None,
        "annualCostRate": annual_cost,
        "annualCostApplication": "value_deduction_every_12_months",
        "transactionCosts": "none",
        "proxySeries": {proxy: inputs.tickers.get(proxy, proxy) for proxy in weights},
        "proxyReturnType": {
            proxy: RETURN_TYPES.get(inputs.tickers.get(proxy, ""), "unknown")
            for proxy in weights
        },
        "sensitivityShiftAnnual": SENSITIVITY_SHIFT,
        "goalBasis": "after_simplified_tax" if tax else "market_value",
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
