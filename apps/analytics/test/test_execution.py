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


def test_installed_runner_has_no_analyses_yet() -> None:
    # Real `python -I -m oliginvest_analytics.runner`; BL-313 registers handlers.
    outcome = run()
    assert outcome.status == "failed" and outcome.code == "INTERNAL"


def test_runner_maps_handler_outcomes() -> None:
    request = json.dumps({"type": "goal", "job": {"seed": 1}}).encode()

    def exhausted(job: object) -> dict[str, object]:
        raise MemoryError

    def broken(job: object) -> dict[str, object]:
        raise RuntimeError("contains parameters")

    assert runner.run(request, {"goal": lambda job: {"seed": job["seed"]}}) == {
        "status": "done",
        "result": {"seed": 1},
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
