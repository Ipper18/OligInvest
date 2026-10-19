import asyncio
import json
import os
import socket
from uuid import uuid4

import pytest
from test_contracts import base

from oliginvest_analytics.contracts import InvalidJob, ValidatedJob, check_result
from oliginvest_analytics.execution import Outcome
from oliginvest_analytics.worker import (
    check_health,
    process_analytics,
    process_ping,
    read_config,
    run_worker,
)


def environment():
    return {
        "NODE_ENV": "test",
        "VALKEY_QUEUE_HOST": "localhost",
        "VALKEY_QUEUE_PORT": "6379",
        "VALKEY_QUEUE_USER": "default",
        "VALKEY_QUEUE_ANALYTICS_PASSWORD": "synthetic",
        "DB_ANALYTICS_RO_PASSWORD": "synthetic",
        "ANALYTICS_INSTANCE_ID": "test",
    }


def test_socket_guard():
    with socket.socket() as sock:
        for operation in [sock.connect, sock.connect_ex]:
            with pytest.raises(OSError, match="Network blocked"):
                operation(("example.invalid", 443))
        with pytest.raises(OSError, match="Network blocked"):
            sock.connect(("localhost", 5432))
    with pytest.raises(OSError, match="Network blocked"):
        socket.getaddrinfo("example.invalid", 443)
    with (
        socket.socket(type=socket.SOCK_DGRAM) as sock,
        pytest.raises(OSError, match="Network blocked"),
    ):
        sock.sendto(b"blocked", ("example.invalid", 53))


def test_mode_and_secrets(tmp_path):
    env = environment()
    for value in [None, "", "prod"]:
        with pytest.raises(ValueError):
            read_config({**env, "NODE_ENV": value})
    with pytest.raises(ValueError):
        read_config({**env, "NODE_ENV": "production"})
    for name in ["VALKEY_QUEUE_ANALYTICS_PASSWORD", "DB_ANALYTICS_RO_PASSWORD"]:
        path = tmp_path / name
        path.write_text(env.pop(name) + "\n")
        env[name + "_FILE"] = str(path)
    assert read_config({**env, "NODE_ENV": "production"}).mode == "production"
    with pytest.raises(ValueError):
        read_config({**env, "DB_ANALYTICS_RO_PASSWORD": "conflict"})


def test_strict_ping():
    request_id = str(uuid4())
    payload = {"version": 1, "requestId": request_id}
    assert process_ping("ping", payload) == {**payload, "received": True}
    for name, data in [
        ("analysis", payload),
        ("ping", {**payload, "extra": 1}),
        ("ping", {**payload, "version": True}),
        ("ping", {}),
        ("ping", {**payload, "requestId": "invalid"}),
    ]:
        with pytest.raises(ValueError, match="Invalid smoke job"):
            process_ping(name, data)


def test_analytics_job_flow_validates_before_running():
    calls: list[ValidatedJob] = []

    async def timeout(job: ValidatedJob) -> Outcome:
        calls.append(job)
        return Outcome("failed", code="TIMEOUT")

    job = base()
    result = asyncio.run(process_analytics("monte_carlo", job, timeout))
    assert len(calls) == 1 and result["runId"] == str(calls[0].run_id)
    assert result["error"] == {"code": "TIMEOUT"}
    assert check_result(result)

    calls.clear()
    over_limit = {**job, "params": {**job["params"], "paths": 10001}}
    rejected = asyncio.run(process_analytics("monte_carlo", over_limit, timeout))
    assert calls == []
    assert rejected["error"] == {"code": "INVALID_PARAMS"} and check_result(rejected)

    with pytest.raises(InvalidJob):
        asyncio.run(process_analytics("monte_carlo", {"runId": "x"}, timeout))
    assert calls == []


def test_unknown_result_shapes_never_leave_the_worker():
    async def done(job: ValidatedJob) -> Outcome:
        return Outcome("done", result={"percentiles": [1, 2, 3]})

    result = asyncio.run(process_analytics("goal", base("goal"), done))
    assert result["status"] == "failed" and result["error"] == {"code": "INTERNAL"}
    assert "result" not in result and check_result(result)


@pytest.mark.skipif(
    not os.environ.get("OLIGINVEST_QUEUE_TEST"), reason="requires Compose runner"
)
def test_node_to_python_real_valkey():
    async def scenario():
        config = read_config(os.environ)
        stop = asyncio.Event()
        worker = asyncio.create_task(run_worker(config, stop))
        try:
            async with asyncio.timeout(20):
                while not await check_health(config):
                    await asyncio.sleep(0.05)
                from bullmq import Job, Queue

                queue = Queue("analytics-smoke", {"connection": config.connection})
                try:
                    expected = json.loads(os.environ["OLIGINVEST_QUEUE_TEST"])
                    while True:
                        job = await Job.fromId(queue, expected["requestId"])
                        if job and await job.getState() == "completed":
                            assert job.returnvalue == {**expected, "received": True}
                            break
                        await asyncio.sleep(0.05)
                finally:
                    await queue.close()
                # Node asserts the analytics-results payloads after this run.
                analytics = Queue("analytics", {"connection": config.connection})
                try:
                    pending = json.loads(os.environ.get("OLIGINVEST_ANALYTICS_TEST", "[]"))
                    for job_id in pending:
                        while True:
                            job = await Job.fromId(analytics, job_id)
                            state = await job.getState() if job else None
                            if state in ("completed", "failed"):
                                break
                            await asyncio.sleep(0.05)
                finally:
                    await analytics.close()
        finally:
            stop.set()
            await asyncio.wait_for(worker, 5)
        assert not await check_health(config)

    asyncio.run(scenario())
