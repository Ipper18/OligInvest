"""M0 transport probe. No analytics or database queries."""

import asyncio
import json
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

from bullmq import Queue, Worker  # type: ignore[import-untyped]


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


def log(event: str, request_id: str | None = None) -> None:
    entry = {"event": event}
    if request_id:
        entry["request_id"] = request_id
    print(json.dumps(entry), flush=True)


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
    worker = None

    async def process(job: Any, token: str) -> dict[str, object]:
        result = process_ping(job.name, job.data)
        log("analytics.received", str(result["requestId"]))
        return result

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
        if worker:
            await worker.close()
        try:
            async with asyncio.timeout(2):
                await queue.client.delete(config.heartbeat_key)
        finally:
            await queue.close()
