import copy
import json
from decimal import Decimal
from importlib.resources import files
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest

from oliginvest_analytics.contracts import (
    JOB_TYPES,
    LIMITS,
    TIMEOUTS_SECONDS,
    InvalidJob,
    check_result,
    read_money,
    validate_job,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (ROOT / "packages/contracts/test/fixtures/analytics-job-cases.json").read_text(
        encoding="utf-8"
    )
)


def apply_case(case: dict[str, Any]) -> dict[str, Any]:
    job = copy.deepcopy(FIXTURE["bases"][case["base"]])

    def walk(path: list[Any]) -> tuple[Any, Any]:
        node = job
        for key in path[:-1]:
            node = node[key]
        return node, path[-1]

    for change in case["set"]:
        node, key = walk(change["path"])
        node[key] = change["value"]
    for path in case["delete"]:
        node, key = walk(path)
        del node[key]
    return job


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_shared_cases_match_zod(case: dict[str, Any]) -> None:
    job = apply_case(case)
    name = job["type"] if isinstance(job.get("type"), str) else "monte_carlo"
    if case["valid"]:
        assert validate_job(name, job).data == job
    else:
        with pytest.raises(InvalidJob):
            validate_job(name, job)


def base(kind: str = "monte_carlo") -> dict[str, Any]:
    return copy.deepcopy(FIXTURE["bases"][kind])


def test_schema_ships_inside_the_package_with_limits_and_timeouts() -> None:
    resource = files("oliginvest_analytics").joinpath(
        "schemas/analytics-jobs.schema.json"
    )
    document = json.loads(resource.read_text(encoding="utf-8"))
    assert document["job"]["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert JOB_TYPES == tuple(FIXTURE["bases"])
    assert set(TIMEOUTS_SECONDS) == set(JOB_TYPES)
    assert LIMITS["monteCarloPaths"] == 10_000
    assert LIMITS["backtestCombinations"] == 500
    assert TIMEOUTS_SECONDS["monte_carlo"] == 60


@pytest.mark.parametrize(
    "value",
    [float("nan"), float("inf"), float("-inf")],
    ids=["nan", "inf", "-inf"],
)
def test_non_finite_numbers_cannot_slip_past_bounds(value: float) -> None:
    # json.loads accepts NaN/Infinity; NaN compares false against minimum/maximum.
    job = base()
    job["params"]["inflationRate"] = value
    with pytest.raises(InvalidJob) as raised:
        validate_job("monte_carlo", job)
    assert raised.value.run_id == UUID(job["runId"])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda job: job["portfolio"]["cash"].update(amount="1\x00"),
        lambda job: job.update(runId=job["runId"] + "\n"),
        lambda job: job["params"].update(model="x" * 10_000),
        lambda job: job["params"]["withdrawals"].append(
            {"amount": {"amount": "1", "currency": "PLN"}, "nested": [[[[[[[[]]]]]]]]}
        ),
    ],
    ids=["nul", "newline", "long-string", "deep-nesting"],
)
def test_structural_guard(mutate: Any) -> None:
    job = base()
    mutate(job)
    with pytest.raises(InvalidJob):
        validate_job("monte_carlo", job)


def test_payload_size_limit() -> None:
    job = base("backtest")
    job["params"]["optimization"]["grid"] = {
        f"p{index}": [0.123456789] * 20 for index in range(2000)
    }
    assert len(json.dumps(job)) > LIMITS["jobPayloadBytes"]
    with pytest.raises(InvalidJob):
        validate_job("backtest", job)


def test_job_name_must_match_type_and_run_id_is_reported_only_when_safe() -> None:
    job = base()
    with pytest.raises(InvalidJob) as raised:
        validate_job("goal", job)
    assert raised.value.run_id == UUID(job["runId"])
    for broken in [{"runId": "x" * 36}, ["not", "an", "object"], None]:
        with pytest.raises(InvalidJob) as raised:
            validate_job("monte_carlo", broken)
        assert raised.value.run_id is None
    assert "monte_carlo" not in str(raised.value)


def test_amounts_become_decimal_without_float() -> None:
    job = validate_job("monte_carlo", base())
    money = read_money(job.data["portfolio"]["cash"])
    assert money.amount == Decimal("1250.50")
    assert isinstance(money.amount, Decimal)
    assert money.currency == "PLN"


def test_results_are_closed_and_use_openapi_error_codes() -> None:
    failure = {
        "v": 1,
        "runId": FIXTURE["bases"]["goal"]["runId"],
        "status": "failed",
        "error": {"code": "TIMEOUT"},
        "finishedAt": "2026-10-19T08:31:00.000Z",
        "durationMs": 60000,
    }
    assert check_result(failure)
    assert not check_result({**failure, "error": {"code": "TIMEOUT", "trace": "x"}})
    assert not check_result({**failure, "status": "done", "result": {}})
    assert not check_result({**failure, "userId": failure["runId"]})
