"""Queue consumer: contract validation, time-limited execution, results. No DB queries."""

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from bullmq import Queue, Worker  # type: ignore[import-untyped]

from .contracts import VERSION, InvalidJob, ValidatedJob, check_result, validate_job
from .execution import Outcome, execute

ANALYTICS_QUEUE = "analytics"
RESULTS_QUEUE = "analytics-results"
# jobs writes results under the owner's RLS context and retries idempotently by runId.
RESULT_OPTIONS = {
    "attempts": 5,
    "backoff": {"type": "exponential", "delay": 1000},
    "removeOnComplete": 1000,
    "removeOnFail": 5000,
}


@dataclass(frozen=True)
class Config:
    mode: str
    connection: dict[str, Any]
    heartbeat_key: str


def read_config(env: Mapping[str, str | None]) -> Config:
    mode = env.get("NODE_ENV")
    if mode not in ("development", "test", "production"):
        raise ValueError("Invalid NODE_ENV")
    secrets: dict[str, str] = {}
    for key in ("DB_ANALYTICS_RO_PASSWORD", "VALKEY_QUEUE_ANALYTICS_PASSWORD"):
        direct, filename = env.get(key), env.get(key + "_FILE")
        direct = direct if direct and direct.strip() else None
        filename = filename if filename and filename.strip() else None
        if direct and filename or mode == "production" and not filename:
            raise ValueError(f"Invalid secret source: {key}")
        if filename:
            path = Path(filename)
            if not path.is_absolute() or not path.is_file():
                raise ValueError(f"Invalid secret file: {key}")
            with path.open("rb") as stream:
                content = stream.read(65537)
            if len(content) > 65536:
                raise ValueError(f"Invalid secret size: {key}")
            direct = content.decode("utf-8").removesuffix("\n").removesuffix("\r")
        if (
            not direct
            or len(direct) > 65536
            or any(ord(c) < 32 or ord(c) == 127 for c in direct)
        ):
            raise ValueError(f"Invalid secret: {key}")
        secrets[key] = direct
    host = env.get("VALKEY_QUEUE_HOST") or ""
    username = env.get("VALKEY_QUEUE_USER") or ""
    instance = env.get("ANALYTICS_INSTANCE_ID") or ""
    port = int(env.get("VALKEY_QUEUE_PORT") or "0")
    if not re.fullmatch(r"[a-zA-Z0-9.:[\]_-]{1,253}", host) or not username:
        raise ValueError("Invalid queue endpoint")
    if not 1 <= port <= 65535 or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", instance):
        raise ValueError("Invalid queue port or instance")
    return Config(
        str(mode),
        {
            "host": host,
            "port": port,
            "username": username,
            "password": secrets["VALKEY_QUEUE_ANALYTICS_PASSWORD"],
            "socket_connect_timeout": 1.5,
        },
        f"health:analytics:{instance}",
    )


def process_ping(name: str, payload: object) -> dict[str, object]:
    if (
        name != "ping"
        or not isinstance(payload, dict)
        or set(payload) != {"version", "requestId"}
    ):
        raise ValueError("Invalid smoke job")
    if type(payload["version"]) is not int or payload["version"] != 1:
        raise ValueError("Invalid smoke job")
    request_id = payload["requestId"]
    try:
        if not isinstance(request_id, str) or str(UUID(request_id)) != request_id:
            raise ValueError("Invalid UUID")
    except ValueError:
        raise ValueError("Invalid smoke job") from None
    return {"version": 1, "requestId": request_id, "received": True}


def log(event: str, request_id: str | None = None, **fields: str) -> None:
    entry = {"event": event}
    if request_id:
        entry["request_id"] = request_id
    entry.update(fields)
    print(json.dumps(entry), flush=True)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def process_analytics(
    name: str,
    data: object,
    run: Callable[[ValidatedJob], Awaitable[Outcome]] = execute,
) -> dict[str, Any]:
    """Build the analytics-results envelope; InvalidJob escapes only without a runId."""
    started = time.monotonic()
    try:
        job = validate_job(name, data)
    except InvalidJob as error:
        if error.run_id is None:
            raise
        run_id, outcome = error.run_id, Outcome("failed", code="INVALID_PARAMS")
    else:
        run_id, outcome = job.run_id, await run(job)
    result: dict[str, Any] = {
        "v": VERSION,
        "runId": str(run_id),
        "status": outcome.status,
        "finishedAt": _timestamp(),
        "durationMs": int((time.monotonic() - started) * 1000),
    }
    if outcome.status == "done":
        result["result"] = outcome.result
    else:
        result["error"] = {"code": outcome.code}
    if not check_result(result):
        # A shape the contract does not know (e.g. results before BL-313) never leaves.
        result = {**result, "status": "failed", "error": {"code": "INTERNAL"}}
        result.pop("result", None)
    return result


async def check_health(config: Config) -> bool:
    queue = Queue("analytics-smoke", {"connection": config.connection})
    try:
        async with asyncio.timeout(2):
            if not await queue.client.ping():
                return False
            heartbeat = await queue.client.get(config.heartbeat_key)
            return (
                heartbeat is not None
                and 0 <= time.time() * 1000 - int(heartbeat) <= 10000
            )
    except (OSError, ValueError, TimeoutError):
        return False
    finally:
        await queue.close()


async def run_worker(config: Config, stop: asyncio.Event) -> None:
    queue = Queue("analytics-smoke", {"connection": config.connection})
    results = Queue(RESULTS_QUEUE, {"connection": config.connection})
    worker = None
    analytics = None

    async def process(job: Any, token: str) -> dict[str, object]:
        result = process_ping(job.name, job.data)
        log("analytics.received", str(result["requestId"]))
        return result

    async def analyse(job: Any, token: str) -> dict[str, object]:
        try:
            result = await process_analytics(job.name, job.data)
        except InvalidJob:
            log("analytics.job_rejected")
            raise
        await results.add(
            "analytics.result", result, {**RESULT_OPTIONS, "jobId": result["runId"]}
        )
        code = result.get("error", {}).get("code", "")
        log("analytics.job_finished", run_id=result["runId"], code=code)
        return {"v": VERSION, "runId": result["runId"], "status": result["status"]}

    try:
        async with asyncio.timeout(3):
            await queue.client.ping()
        # Production never consumes the M0 transport test queue.
        if config.mode != "production":
            worker = Worker(
                "analytics-smoke",
                process,
                {
                    "connection": config.connection,
                    "concurrency": 1,
                    "drainDelay": 1,
                },
            )
            worker.on("error", lambda *_: log("analytics.worker_failed"))
        # Concurrency 1: one heavy analysis at a time next to Immich (Z-19).
        analytics = Worker(
            ANALYTICS_QUEUE,
            analyse,
            {"connection": config.connection, "concurrency": 1, "drainDelay": 1},
        )
        analytics.on("error", lambda *_: log("analytics.worker_failed"))
        log("analytics.ready")
        while not stop.is_set():
            async with asyncio.timeout(2):
                await queue.client.set(
                    config.heartbeat_key, str(int(time.time() * 1000)), px=10000
                )
            try:
                await asyncio.wait_for(stop.wait(), 1)
            except TimeoutError:
                pass
    finally:
        for consumer in (worker, analytics):
            if consumer:
                await consumer.close()
        try:
            async with asyncio.timeout(2):
                await queue.client.delete(config.heartbeat_key)
        finally:
            await queue.close()
            await results.close()
