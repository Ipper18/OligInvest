"""Stress tests of today's positions (obliczenia-finansowe.md § 12.3, BL-556).

Pure computation without I/O: runs in the secretless child process on market data that the parent
read as `analytics_ro` (`stress_data.py`). Every scenario is conditional ("what would happen to the
current positions if…"), never a forecast, and every number comes with its range: the path of the
historical window (trough and peak), the 90 % interval of the factor beta, or the one-month
P5–P95 band. Statistics are float64 (§ 0.1); amounts enter as Decimal text and leave rounded.
"""

import platform
from bisect import bisect_right
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import numpy as np
import numpy.typing as npt

ALGORITHM_VERSION = "stress-1.0.0"
COVERAGE_THRESHOLD = (
    0.8  # share of position value (without cash) with a series (§ 12.3)
)
EDGE_TOLERANCE_DAYS = 7  # the last close before a window edge may be at most this old
BETA_MONTHS = 60  # monthly PLN returns before the snapshot month
Z90 = 1.6448536269514722  # two-sided 90 % (normal approximation)
LOW_FIT_R2 = 0.3
ILLIQUID_SHARE = 0.2  # sessions without trades (GPW `no_trades`) in the window
DEFAULT_CORRELATION = 0.9
CENT = Decimal("0.01")

type Array = npt.NDArray[np.float64]
type Progress = Callable[[int, str], None]
type Bars = Sequence[
    tuple[str, float, bool]
]  # (session date, adjusted close, no trades)


class CoverageTooLow(ValueError):
    """No scenario reached the coverage threshold (AnalyticsRun.error COVERAGE_TOO_LOW)."""


class NoScenarioData(ValueError):
    """No scenario had the data it needs (AnalyticsRun.error INSUFFICIENT_DATA)."""


@dataclass(frozen=True)
class Position:
    instrument: str
    proxy: str
    value: Decimal


def _positions(portfolio: Mapping[str, Any]) -> list[Position]:
    return [
        Position(
            p["instrumentId"], p["proxyInstrumentId"], Decimal(p["value"]["amount"])
        )
        for p in portfolio["positions"]
    ]


def _money(value: Decimal) -> dict[str, str]:
    amount = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return {"amount": "0.00" if amount == 0 else f"{amount:.2f}", "currency": "PLN"}


def _loss(base: Decimal, ratio: float) -> dict[str, str]:
    """Positive when the value falls (§ 12.3 sign convention)."""
    return _money(-base * Decimal(repr(ratio)))


def _r(value: float) -> float:
    return round(float(value), 6)


# ── historical windows ────────────────────────────────────────────────────────


def _day(text: str) -> date:
    return date.fromisoformat(text)


@dataclass(frozen=True)
class WindowSeries:
    dates: list[str]  # sessions from the start point to the end point
    ratios: list[float]  # PLN value relative to the start point (first = 1)
    local_return: float  # end / start − 1 in the quote currency
    illiquid: bool


def _rate_on(fx: Sequence[tuple[str, float]], day: str) -> float | None:
    """Last NBP table rate on or before the day (carry-forward over non-publication days)."""
    index = bisect_right([d for d, _ in fx], day)
    return fx[index - 1][1] if index else None


def window_series(
    bars: Bars, fx: Sequence[tuple[str, float]] | None, start: str, end: str
) -> WindowSeries | None:
    """The series covers the window when it has a close at most 7 days before each edge and an
    NBP rate for both points; returns PLN ratios on its own sessions inside the window."""
    days = [d for d, _, _ in bars]
    first = bisect_right(days, start) - 1
    last = bisect_right(days, end) - 1
    if first < 0 or last <= first:
        return None
    limit = timedelta(days=EDGE_TOLERANCE_DAYS)
    if _day(start) - _day(days[first]) > limit or _day(end) - _day(days[last]) > limit:
        return None
    window = bars[first : last + 1]
    rates = [1.0 if fx is None else _rate_on(fx, d) for d, _, _ in window]
    base_close = window[0][1]
    if rates[0] is None or rates[-1] is None or base_close <= 0:
        return None
    base = base_close * rates[0]
    dates, ratios = [], []
    for (day, close, _), rate in zip(window, rates, strict=True):
        if rate is not None:
            dates.append(day)
            ratios.append(close * rate / base)
    # Index bars carry no volume; the GPW flag of a session without trades is the signal.
    sessions = window[1:]
    idle = sum(1 for _, _, no_trades in sessions if no_trades)
    return WindowSeries(
        dates,
        ratios,
        window[-1][1] / base_close - 1,
        bool(sessions) and idle / len(sessions) > ILLIQUID_SHARE,
    )


# ── monthly series for betas and volatility ───────────────────────────────────


def monthly_returns(
    closes: Mapping[str, float],
    fx: Mapping[str, float] | None,
    months: Sequence[str],
) -> Array | None:
    """Returns of months[1:] (PLN when fx is given); None unless every month is present."""
    values = []
    for month in months:
        close = closes.get(month)
        rate = 1.0 if fx is None else fx.get(month)
        if close is None or rate is None or close <= 0:
            return None
        values.append(close * rate)
    prices = np.asarray(values, dtype=np.float64)
    returns: Array = prices[1:] / prices[:-1] - 1
    return returns


@dataclass(frozen=True)
class Fit:
    beta: float
    low: float
    high: float
    r2: float


def regress(y: Array, f: Array) -> Fit | None:
    """OLS y = α + β·f with the 90 % interval β ± z·SE (normal approximation)."""
    n = y.size
    centred = f - f.mean()
    spread = float(centred @ centred)
    if n < 3 or spread <= 0:
        return None
    beta = float(centred @ (y - y.mean())) / spread
    residual = y - y.mean() - beta * centred
    ssr = float(residual @ residual)
    se = float(np.sqrt(ssr / (n - 2) / spread))
    total = float((y - y.mean()) @ (y - y.mean()))
    r2 = 1 - ssr / total if total > 0 else 0.0
    return Fit(beta, beta - Z90 * se, beta + Z90 * se, r2)


# ── scenario evaluation ───────────────────────────────────────────────────────


@dataclass
class Notes:
    """Run-level warnings, one per code (≤ 20 in the contract)."""

    items: dict[str, dict[str, str]]

    def add(self, code: str, severity: str, message: str) -> None:
        self.items.setdefault(
            code, {"code": code, "severity": severity, "message": message}
        )


def _coverage(
    positions: Sequence[Position], chosen: Mapping[str, str]
) -> tuple[float, float]:
    total = sum((p.value for p in positions), Decimal(0))
    if total <= 0:
        return 0.0, 0.0
    covered = sum(
        (p.value for p in positions if chosen[p.instrument] != "none"), Decimal(0)
    )
    own = sum(
        (p.value for p in positions if chosen[p.instrument] == "instrument"),
        Decimal(0),
    )
    return float(covered / total), float(own / total)


def _refused(
    row: dict[str, Any], status: str, positions: Sequence[Position]
) -> dict[str, Any]:
    return {
        **row,
        "status": status,
        "portfolioReturn": None,
        "portfolioLoss": None,
        "returnRange": None,
        "positions": [
            {
                "instrumentId": p.instrument,
                "proxyInstrumentId": p.proxy,
                "series": row["_series"].get(p.instrument, "none"),
                "returnRatio": None,
            }
            for p in positions
        ],
    }


def _choose(
    positions: Sequence[Position],
    available: Callable[[str], bool],
    holds: set[str],
) -> dict[str, str]:
    """Own series when complete and without a BLOCK, else the proxy, else none (§ 12.3)."""
    chosen: dict[str, str] = {}
    for p in positions:
        if p.instrument not in holds and available(p.instrument):
            chosen[p.instrument] = "instrument"
        elif p.proxy != p.instrument and available(p.proxy):
            chosen[p.instrument] = "proxy"
        else:
            chosen[p.instrument] = "none"
    return chosen


def _series_id(position: Position, kind: str) -> str:
    return position.instrument if kind == "instrument" else position.proxy


def historical_scenario(
    scenario: Mapping[str, Any],
    positions: Sequence[Position],
    cash: Decimal,
    window: Mapping[str, Any],
    currencies: Mapping[str, str],
    holds: set[str],
    notes: Notes,
) -> dict[str, Any]:
    start, end = scenario["from"], scenario["to"]
    bars: Mapping[str, Bars] = window["bars"]
    fx_rates: Mapping[str, Sequence[tuple[str, float]]] = window["fx"]
    cache: dict[str, WindowSeries | None] = {}

    def series(instrument: str) -> WindowSeries | None:
        if instrument not in cache:
            currency = currencies.get(instrument)
            fx = None if currency == "PLN" else fx_rates.get(str(currency))
            cache[instrument] = (
                None
                if currency is None or (currency != "PLN" and fx is None)
                else window_series(bars.get(instrument, []), fx, start, end)
            )
        return cache[instrument]

    chosen = _choose(positions, lambda i: series(i) is not None, holds)
    coverage, own = _coverage(positions, chosen)
    row: dict[str, Any] = {
        "key": scenario["key"],
        "name": scenario["name"],
        "kind": "historical",
        "periodFrom": start,
        "periodTo": end,
        "coverageRatio": _r(coverage),
        "ownHistoryRatio": _r(own),
        "_series": chosen,
    }
    if coverage < COVERAGE_THRESHOLD:
        return _refused({**row, "troughDate": None}, "coverage_too_low", positions)
    covered = [p for p in positions if chosen[p.instrument] != "none"]
    base = cash + sum((p.value for p in covered), Decimal(0))
    used = {p.instrument: series(_series_id(p, chosen[p.instrument])) for p in covered}
    dates = sorted({d for item in used.values() if item for d in item.dates})
    index = {d: i for i, d in enumerate(dates)}
    path = np.full(len(dates), float(cash))
    rows = []
    for p in positions:
        item: dict[str, Any] = {
            "instrumentId": p.instrument,
            "proxyInstrumentId": p.proxy,
            "series": chosen[p.instrument],
        }
        own_series = used.get(p.instrument)
        if own_series is None:
            rows.append({**item, "returnRatio": None, "loss": None})
            continue
        ratio = np.full(len(dates), np.nan)
        for d, value in zip(own_series.dates, own_series.ratios, strict=True):
            ratio[index[d]] = value
        # Carry the last value over days without a session of this series.
        last = 1.0
        for i in range(len(dates)):
            if np.isnan(ratio[i]):
                ratio[i] = last
            last = ratio[i]
        path += float(p.value) * ratio
        result = own_series.ratios[-1] - 1
        proxy = (
            series(p.proxy)
            if chosen[p.instrument] == "instrument" and p.proxy != p.instrument
            else None
        )
        rows.append(
            {
                **item,
                "returnRatio": _r(result),
                "localReturnRatio": _r(own_series.local_return),
                "proxyReturnRatio": None if proxy is None else _r(proxy.ratios[-1] - 1),
                "loss": _loss(p.value, result),
                "illiquid": own_series.illiquid
                and chosen[p.instrument] == "instrument",
            }
        )
        if own_series.illiquid and chosen[p.instrument] == "instrument":
            notes.add(
                "ILLIQUID_SERIES",
                "warning",
                "Część instrumentów ma ponad 20 % sesji bez transakcji w oknie scenariusza; "
                "zamknięcia mogą być nieaktualne, a spadek zaniżony.",
            )
    returns = path / float(base) - 1
    end_return = float(returns[-1])
    lowest = int(np.argmin(returns))
    trough = min(0.0, float(returns[lowest]))
    return {
        **row,
        "status": "ok",
        "troughDate": dates[lowest] if trough < 0 else None,
        "portfolioReturn": _r(end_return),
        "portfolioLoss": _loss(base, end_return),
        "returnRange": {
            "low": _r(trough),
            "high": _r(max(0.0, float(returns.max()))),
            "basis": "window_path",
        },
        "positions": rows,
    }


@dataclass(frozen=True)
class Monthly:
    months: Sequence[
        str
    ]  # BETA_MONTHS + 1 month labels, the first only as a base price
    pln: Mapping[str, Array | None]  # instrument → PLN returns
    local: Mapping[str, Array | None]  # instrument → quote-currency returns
    fx: Mapping[str, Array | None]  # currency → NBP rate changes


def _shock_name(item: Mapping[str, Any], tickers: Mapping[str, str]) -> str:
    if item["kind"] == "index_shock":
        verb = "Spadek" if item["shock"] < 0 else "Wzrost"
        ticker = tickers.get(item["instrumentId"], "indeksu")
        return f"{verb} {ticker} o {abs(item['shock']):.0%} (w walucie notowania)"
    if item["kind"] == "fx_shock":
        return f"Zmiana kursu {item['currency']}/PLN o {item['shock']:+.0%}"
    return f"Korelacje pozycji równe {item['correlation']:.2f}"


def hypothetical_scenario(
    index: int,
    item: Mapping[str, Any],
    positions: Sequence[Position],
    cash: Decimal,
    monthly: Monthly,
    currencies: Mapping[str, str],
    tickers: Mapping[str, str],
    holds: set[str],
    notes: Notes,
) -> dict[str, Any]:
    kind = item["kind"]
    chosen = _choose(positions, lambda i: monthly.pln.get(i) is not None, holds)
    coverage, own = _coverage(positions, chosen)
    row: dict[str, Any] = {
        "key": f"{kind}_{index + 1}",
        "name": _shock_name(item, tickers),
        "kind": "hypothetical",
        "shockKind": kind,
        "coverageRatio": _r(coverage),
        "ownHistoryRatio": _r(own),
        "_series": chosen,
    }
    if kind == "index_shock":
        row |= {"shock": item["shock"], "shockInstrumentId": item["instrumentId"]}
    elif kind == "fx_shock":
        row |= {"shock": item["shock"], "shockCurrency": item["currency"]}
    else:
        row |= {"correlation": item["correlation"]}
    if kind == "fx_shock":
        row["translationReturn"] = None
    if coverage < COVERAGE_THRESHOLD:
        return _refused(row, "coverage_too_low", positions)
    covered = [p for p in positions if chosen[p.instrument] != "none"]
    base = cash + sum((p.value for p in covered), Decimal(0))
    weights = np.asarray([float(p.value / base) for p in covered])
    matrix = np.vstack(
        [np.asarray(monthly.pln[_series_id(p, chosen[p.instrument])]) for p in covered]
    )
    portfolio = weights @ matrix  # cash earns 0 in the scenario (explicit assumption)
    position_rows: dict[str, dict[str, Any]] = {
        p.instrument: {
            "instrumentId": p.instrument,
            "proxyInstrumentId": p.proxy,
            "series": chosen[p.instrument],
            "returnRatio": None,
            "loss": None,
        }
        for p in positions
    }

    if kind == "correlation_shock":
        rho = float(item["correlation"])
        sigma = (
            matrix.std(axis=1, ddof=1)
            if matrix.shape[1] > 1
            else np.zeros(len(covered))
        )
        stressed = np.outer(sigma, sigma) * rho
        np.fill_diagonal(stressed, sigma**2)
        baseline = np.atleast_2d(np.cov(matrix, ddof=1))
        sd = float(np.sqrt(max(float(weights @ stressed @ weights), 0.0)))
        sd_base = float(np.sqrt(max(float(weights @ baseline @ weights), 0.0)))
        for p, s in zip(covered, sigma, strict=True):
            tail = -Z90 * float(s)
            position_rows[p.instrument] |= {
                "returnRatio": _r(tail),
                "volatility": _r(float(s)),
                "loss": _loss(p.value, tail),
            }
        notes.add(
            "NORMAL_TAILS",
            "info",
            "Szok korelacji używa rozkładu normalnego dla jednego miesiąca; w kryzysach ogony są "
            "grubsze, więc rzeczywiste skrajne straty bywają większe.",
        )
        low = -Z90 * sd
        return {
            **row,
            "status": "ok",
            "portfolioReturn": _r(low),
            "portfolioLoss": _loss(base, low),
            "returnRange": {
                "low": _r(low),
                "high": _r(-low),
                "basis": "one_month_p5_p95",
            },
            "baselineRange": {"low": _r(-Z90 * sd_base), "high": _r(Z90 * sd_base)},
            "positions": list(position_rows.values()),
        }

    factor = (
        monthly.local.get(item["instrumentId"])
        if kind == "index_shock"
        else monthly.fx.get(item["currency"])
    )
    fit = None if factor is None else regress(portfolio, factor)
    if factor is None or fit is None:
        return _refused(row, "insufficient_data", positions)
    shock = float(item["shock"])
    for p, series in zip(covered, matrix, strict=True):
        own_fit = regress(series, factor)
        if own_fit is None:
            continue
        position_rows[p.instrument] |= {
            "beta": _r(own_fit.beta),
            "betaLow": _r(own_fit.low),
            "betaHigh": _r(own_fit.high),
            "returnRatio": _r(own_fit.beta * shock),
            "loss": _loss(p.value, own_fit.beta * shock),
        }
    if fit.r2 < LOW_FIT_R2:
        notes.add(
            "LOW_FACTOR_FIT",
            "warning",
            "Czynnik wyjaśnia mniej niż 30 % zmienności portfela (R²); wynik szoku "
            "jednoczynnikowego mówi o portfelu niewiele.",
        )
    notes.add(
        "LINEAR_SINGLE_FACTOR",
        "info",
        "Szoki hipotetyczne zakładają liniową zależność od jednego czynnika z ostatnich 60 "
        "miesięcy; w kryzysach bety i korelacje zwykle rosną.",
    )
    ends = sorted((fit.low * shock, fit.high * shock))
    central = fit.beta * shock
    if kind == "fx_shock":
        exposed = sum(
            (
                p.value
                for p in covered
                if currencies.get(p.instrument) == item["currency"]
            ),
            Decimal(0),
        )
        row["translationReturn"] = _r(float(exposed / base) * shock)
    return {
        **row,
        "status": "ok",
        "portfolioReturn": _r(central),
        "portfolioLoss": _loss(base, central),
        "returnRange": {"low": _r(ends[0]), "high": _r(ends[1]), "basis": "beta_ci90"},
        "positions": list(position_rows.values()),
    }


def _monthly(data: Mapping[str, Any]) -> Monthly:
    months: list[str] = data["months"]
    closes: Mapping[str, Mapping[str, float]] = data["closes"]
    fx: Mapping[str, Mapping[str, float]] = data["fx"]
    currencies: Mapping[str, str] = data["currencies"]
    pln: dict[str, Array | None] = {}
    local: dict[str, Array | None] = {}
    for instrument, series in closes.items():
        currency = currencies.get(instrument)
        local[instrument] = monthly_returns(series, None, months)
        if currency == "PLN":
            pln[instrument] = local[instrument]
        else:
            rates = fx.get(str(currency))
            pln[instrument] = (
                None if rates is None else monthly_returns(series, rates, months)
            )
    changes = {
        currency: monthly_returns(rates, None, months) for currency, rates in fx.items()
    }
    return Monthly(months, pln, local, changes)


def run_stress_test(
    job: Mapping[str, Any], data: Mapping[str, Any], progress: Progress | None = None
) -> dict[str, Any]:
    report = progress or (lambda _p, _s: None)
    params, portfolio = job["params"], job["portfolio"]
    positions = _positions(portfolio)
    cash = Decimal(portfolio["cash"]["amount"])
    currencies: Mapping[str, str] = data["currencies"]
    tickers: Mapping[str, str] = data["tickers"]
    holds = set(data["holds"])
    notes = Notes({})
    report(10, "simulating")
    scenarios: list[dict[str, Any]] = []
    for scenario in params["historical"]:
        window = data["historical"][scenario["key"]]
        scenarios.append(
            historical_scenario(
                scenario, positions, cash, window, currencies, holds, notes
            )
        )
    monthly = _monthly(data["monthly"]) if params["hypothetical"] else None
    for index, item in enumerate(params["hypothetical"]):
        assert monthly is not None
        scenarios.append(
            hypothetical_scenario(
                index, item, positions, cash, monthly, currencies, tickers, holds, notes
            )
        )
    report(90, "summarizing")

    statuses = [s["status"] for s in scenarios]
    if "ok" not in statuses:
        if "coverage_too_low" in statuses:
            raise CoverageTooLow()
        raise NoScenarioData()
    if any(s["kind"] == "historical" for s in scenarios):
        notes.add(
            "HISTORICAL_PATH_NOT_WORST_CASE",
            "info",
            "Scenariusz historyczny to jeden przebieg z przeszłości zastosowany do dzisiejszych "
            "pozycji, a nie najgorszy możliwy wynik; kolejny kryzys może przebiec inaczej.",
        )
    proxied = [
        s
        for s in scenarios
        if s["status"] == "ok" and s["ownHistoryRatio"] < s["coverageRatio"]
    ]
    if proxied:
        share = max(s["coverageRatio"] - s["ownHistoryRatio"] for s in proxied)
        notes.add(
            "PROXY_SUBSTITUTED",
            "warning",
            f"Do {share:.0%} wartości pozycji liczono na serii zastępczej (proxy indeksowe); "
            "proxy nie oddaje ryzyka pojedynczego instrumentu.",
        )
    if any(s["status"] == "ok" and s["coverageRatio"] < 1 for s in scenarios):
        notes.add(
            "PARTIAL_COVERAGE",
            "warning",
            "Część pozycji nie ma danych w oknie scenariusza ani proxy; wynik dotyczy pozycji "
            "pokrytych i gotówki.",
        )
    refused = statuses.count("coverage_too_low") + statuses.count("insufficient_data")
    if refused:
        notes.add(
            "SCENARIO_REFUSED",
            "warning",
            f"Pominięto {refused} scenariusz(e): pokrycie wartości poniżej 80 % albo brak danych "
            "czynnika (pola bez wartości).",
        )
    if holds & {p.instrument for p in positions}:
        notes.add(
            "OWN_SERIES_QUALITY_HOLD",
            "warning",
            "Seria części instrumentów czeka na weryfikację jakości; użyto ich proxy.",
        )
    if cash > 0:
        notes.add(
            "CASH_ZERO_RETURN",
            "info",
            "Gotówka w scenariuszach nie zmienia wartości (0 %, założenie).",
        )
    for scenario in scenarios:
        scenario.pop("_series", None)
    months = data["monthly"]["months"] if monthly is not None else []
    assumptions: dict[str, Any] = {
        "method": "conditional_scenarios_on_current_positions",
        "holding": "buy_and_hold_without_rebalancing_or_flows",
        "cashReturn": 0,
        "returnsCurrency": "PLN (NBP table A, carry-forward)",
        "seriesChoice": "instrument_else_proxy_else_none",
        "coverageThreshold": COVERAGE_THRESHOLD,
        "coverageBasis": "position_value_without_cash",
        "edgeToleranceDays": EDGE_TOLERANCE_DAYS,
        "illiquidSessionShare": ILLIQUID_SHARE,
        "scenarioWindows": {
            s["key"]: f"{s['from']}..{s['to']}" for s in params["historical"]
        },
        "betaWindowMonths": BETA_MONTHS if months else None,
        "betaWindowFrom": months[1] if months else None,
        "betaWindowTo": months[-1] if months else None,
        "betaInterval": "90% (normal approximation)" if months else None,
        "factorModel": "OLS single factor, linear" if months else None,
        "correlationModel": "normal, zero mean, one month" if months else None,
        "lossSign": "positive = value falls",
    }
    return {
        "result": {"kind": "stress_test", "currency": "PLN", "scenarios": scenarios},
        "assumptions": {k: v for k, v in assumptions.items() if v is not None},
        "warnings": list(notes.items.values()),
        "reproducibility": {
            "algorithmVersion": ALGORITHM_VERSION,
            "dataVersion": dict(data["data_version"]),
            "libraries": {"numpy": np.__version__, "python": platform.python_version()},
        },
    }
