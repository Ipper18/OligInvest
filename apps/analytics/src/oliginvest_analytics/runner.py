"""Computation process: one validated job on stdin, one outcome on stdout.

Runs as `python -I -m oliginvest_analytics.runner` without secrets in its environment,
so the parent can enforce the per-type wall-clock limit by killing it (ADR-003 § 5).
Progress goes to stderr as one JSON object per line: {"progress": 0-100, "stage": "..."}.
Market data arrives in the request (`data`); this process opens no connections.
"""

import json
import sys
from collections.abc import Callable, Mapping
from typing import Any

from .goal import run_goal
from .montecarlo import InsufficientData, MarketInputs, run_monte_carlo
from .stress import CoverageTooLow, NoScenarioData, run_stress_test

type Progress = Callable[[int, str], None]
type Handler = Callable[
    [Mapping[str, Any], Mapping[str, Any], Progress], Mapping[str, Any]
]


def report(progress: int, stage: str) -> None:
    sys.stderr.write(json.dumps({"progress": progress, "stage": stage}) + "\n")
    sys.stderr.flush()


def market_inputs(data: Mapping[str, Any]) -> MarketInputs:
    return MarketInputs(
        months=data["months"],
        returns=data["returns"],
        cash_rate=data["cash_rate"],
        cash_rate_date=data["cash_rate_date"],
        data_version=data["data_version"],
        tickers=data.get("tickers") or {},
    )


def monte_carlo(
    job: Mapping[str, Any], data: Mapping[str, Any], progress: Progress
) -> Mapping[str, Any]:
    return run_monte_carlo(job, market_inputs(data), progress)


def goal(
    job: Mapping[str, Any], data: Mapping[str, Any], progress: Progress
) -> Mapping[str, Any]:
    return run_goal(job, market_inputs(data), progress)


# FR-04 analyses registered so far; other job types end as INTERNAL until implemented.
HANDLERS: dict[str, Handler] = {
    "monte_carlo": monte_carlo,
    "stress_test": run_stress_test,
    "goal": goal,
}


def run(
    raw: bytes, handlers: Mapping[str, Handler] = HANDLERS, progress: Progress = report
) -> dict[str, Any]:
    request = json.loads(raw)
    handler = handlers.get(request["type"])
    if handler is None:
        return {"status": "failed", "code": "INTERNAL"}
    try:
        return {
            "status": "done",
            "result": dict(
                handler(request["job"], request.get("data") or {}, progress)
            ),
        }
    except (InsufficientData, NoScenarioData):
        return {"status": "failed", "code": "INSUFFICIENT_DATA"}
    except CoverageTooLow:
        return {"status": "failed", "code": "COVERAGE_TOO_LOW"}
    except MemoryError:
        return {"status": "failed", "code": "MEMORY_LIMIT"}
    except Exception:  # noqa: BLE001 - details may contain user parameters
        return {"status": "failed", "code": "INTERNAL"}


def main() -> None:
    outcome = run(sys.stdin.buffer.read())
    sys.stdout.write(json.dumps(outcome, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
