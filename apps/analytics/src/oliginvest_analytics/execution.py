"""Run a validated job in a child process with the per-type time limit."""

import asyncio
import json
import os
import signal
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .contracts import TIMEOUTS_SECONDS, ValidatedJob

RUNNER = (sys.executable, "-I", "-m", "oliginvest_analytics.runner")
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
# Only what the interpreter needs; queue and database secrets never reach analyses.
_INHERITED = ("PATH", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP")
_THREADS = ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")
_SIGKILL = int(getattr(signal, "SIGKILL", 9))


@dataclass(frozen=True)
class Outcome:
    status: str
    code: str | None = None
    result: Mapping[str, Any] | None = None


def child_environment(env: Mapping[str, str] = os.environ) -> dict[str, str]:
    inherited = {key: env[key] for key in _INHERITED if key in env}
    # Two cores per compose.yaml; BLAS must not oversubscribe the shared i5-4590.
    return {**inherited, **dict.fromkeys(_THREADS, "2"), "PYTHONUNBUFFERED": "1"}


def _kill(process: asyncio.subprocess.Process) -> None:
    try:
        if os.name == "posix":
            os.killpg(process.pid, _SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass


async def _read(stream: asyncio.StreamReader) -> bytes | None:
    output = bytearray()
    while chunk := await stream.read(65536):
        output += chunk
        if len(output) > MAX_OUTPUT_BYTES:
            return None
    return bytes(output)


def _parse(output: bytes | None) -> Outcome:
    try:
        outcome = json.loads(output) if output is not None else None
    except ValueError:
        outcome = None
    if isinstance(outcome, dict) and outcome.get("status") == "done":
        result = outcome.get("result")
        if isinstance(result, dict):
            return Outcome("done", result=result)
    if outcome == {"status": "failed", "code": "MEMORY_LIMIT"}:
        return Outcome("failed", code="MEMORY_LIMIT")
    return Outcome("failed", code="INTERNAL")


async def execute(
    job: ValidatedJob,
    *,
    command: Sequence[str] = RUNNER,
    timeout_seconds: float | None = None,
) -> Outcome:
    limit = TIMEOUTS_SECONDS[job.type] if timeout_seconds is None else timeout_seconds
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=child_environment(),
        start_new_session=os.name == "posix",
    )
    assert process.stdin is not None and process.stdout is not None
    request = json.dumps({"type": job.type, "job": job.data}, separators=(",", ":"))
    try:
        async with asyncio.timeout(limit):
            process.stdin.write(request.encode())
            await process.stdin.drain()
            process.stdin.close()
            output = await _read(process.stdout)
            if output is None:
                _kill(process)
            code = await process.wait()
    except TimeoutError:
        _kill(process)
        await process.wait()
        return Outcome("failed", code="TIMEOUT")
    except (BrokenPipeError, ConnectionResetError):
        _kill(process)
        await process.wait()
        return Outcome("failed", code="INTERNAL")
    if code == -_SIGKILL and output is not None:
        # Not killed by us: the container OOM killer picks the computation process.
        return Outcome("failed", code="MEMORY_LIMIT")
    return _parse(output) if code == 0 else Outcome("failed", code="INTERNAL")
