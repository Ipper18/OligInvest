import asyncio
import json
import sys
import time
from pathlib import Path
from uuid import uuid4

import pytest

from oliginvest_analytics import runner
from oliginvest_analytics.contracts import ValidatedJob
from oliginvest_analytics.execution import (
    MAX_OUTPUT_BYTES,
    child_environment,
    execute,
)

JOB = ValidatedJob(uuid4(), "monte_carlo", {"type": "monte_carlo"})


def python(code: str) -> list[str]:
    return [sys.executable, "-c", code]


def run(command: list[str] | None = None, timeout: float = 10) -> object:
    if command is None:
        return asyncio.run(execute(JOB, timeout_seconds=timeout))
    return asyncio.run(execute(JOB, command=command, timeout_seconds=timeout))


def test_cpu_bound_job_is_killed_at_the_time_limit(tmp_path: Path) -> None:
    marker = tmp_path / "still-running"
    code = (
        "import sys,time\n"
        "time.sleep(0)\n"
        f"open({str(marker)!r}, 'w').close()\n"
        "while True: pass\n"
    )
    started = time.monotonic()
    outcome = run(python(code), timeout=1)
    assert outcome.status == "failed" and outcome.code == "TIMEOUT"
    assert time.monotonic() - started < 5
    assert marker.exists()


def test_successful_child_returns_its_result() -> None:
    code = (
        "import json,sys\n"
        "request = json.loads(sys.stdin.read())\n"
        "print(json.dumps({'status': 'done', 'result': {'type': request['type']}}))"
    )
    outcome = run(python(code))
    assert outcome.status == "done"
    assert outcome.result == {"type": "monte_carlo"}


@pytest.mark.parametrize(
    "code",
    [
        "import sys; sys.exit(3)",
        "print('not json')",
        'print(\'{"status": "failed", "code": "INVALID_PARAMS"}\')',
        f"import sys; sys.stdout.write('x' * {MAX_OUTPUT_BYTES + 1})",
    ],
    ids=["exit-code", "garbage", "foreign-code", "oversized-output"],
)
def test_child_failures_become_internal(code: str) -> None:
    outcome = run(python(code))
    assert outcome.status == "failed" and outcome.code == "INTERNAL"


def test_child_environment_carries_no_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_ANALYTICS_RO_PASSWORD", "secret")
    monkeypatch.setenv("VALKEY_QUEUE_ANALYTICS_PASSWORD", "secret")
    code = (
        "import json,os\n"
        "print(json.dumps({'status': 'done', 'result': {'keys': sorted(os.environ)}}))"
    )
    outcome = run(python(code))
    keys = set(outcome.result["keys"])
    assert not {key for key in keys if "PASSWORD" in key or key.startswith("DB_")}
    assert {"OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"} <= keys
    assert set(child_environment({"PATH": "/bin", "NODE_ENV": "production"})) == {
        "PATH",
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "PYTHONUNBUFFERED",
    }


def test_installed_runner_turns_malformed_requests_into_internal() -> None:
    # Real `python -I -m oliginvest_analytics.runner`: a job without params and market data.
    outcome = run()
    assert outcome.status == "failed" and outcome.code == "INTERNAL"


def test_runner_maps_handler_outcomes() -> None:
    request = json.dumps(
        {"type": "goal", "job": {"seed": 1}, "data": {"n": 2}}
    ).encode()

    def exhausted(job: object, data: object, progress: object) -> dict[str, object]:
        raise MemoryError

    def broken(job: object, data: object, progress: object) -> dict[str, object]:
        raise RuntimeError("contains parameters")

    def short(job: object, data: object, progress: object) -> dict[str, object]:
        raise runner.InsufficientData(12)

    def echo(
        job: dict[str, int], data: dict[str, int], progress: object
    ) -> dict[str, int]:
        return {"seed": job["seed"], "n": data["n"]}

    assert runner.run(request, {"goal": echo}) == {
        "status": "done",
        "result": {"seed": 1, "n": 2},
    }
    assert runner.run(request, {"goal": short}) == {
        "status": "failed",
        "code": "INSUFFICIENT_DATA",
    }
    assert runner.run(request, {"goal": exhausted}) == {
        "status": "failed",
        "code": "MEMORY_LIMIT",
    }
    assert runner.run(request, {"goal": broken}) == {
        "status": "failed",
        "code": "INTERNAL",
    }
    assert runner.run(request, {}) == {"status": "failed", "code": "INTERNAL"}


PROGRESS_CHILD = r"""
import json, sys, time
sys.stdin.read()
for p in (10, 60):
    sys.stderr.write(json.dumps({"progress": p, "stage": "simulating"}) + "\n")
    sys.stderr.flush()
sys.stderr.write("noise\n")
sys.stderr.flush()
time.sleep(30)
"""
ECHO_CHILD = r"""
import json, sys
request = json.loads(sys.stdin.read())
print(json.dumps({"status": "done", "result": request["data"]}))
"""


def test_progress_lines_are_forwarded_and_cancellation_kills_the_child() -> None:
    seen: list[tuple[int, str]] = []

    async def scenario() -> object:
        async def on_progress(value: int, stage: str) -> None:
            seen.append((value, stage))

        async def cancelled() -> bool:
            return len(seen) >= 2

        started = time.monotonic()
        outcome = await execute(
            JOB,
            command=python(PROGRESS_CHILD),
            timeout_seconds=20,
            on_progress=on_progress,
            cancelled=cancelled,
        )
        assert time.monotonic() - started < 10
        return outcome

    outcome = asyncio.run(scenario())
    assert outcome.status == "cancelled"
    assert seen == [(10, "simulating"), (60, "simulating")]


def test_market_data_travels_to_the_child_in_the_request() -> None:
    outcome = asyncio.run(
        execute(
            JOB,
            command=python(ECHO_CHILD),
            timeout_seconds=10,
            data={"months": ["2024-01"]},
        )
    )
    assert outcome.status == "done" and outcome.result == {"months": ["2024-01"]}
