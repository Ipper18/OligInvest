"""Worker entry point; explicit environment, quiet failures and graceful shutdown."""

import asyncio
import os
import signal
import sys

from .worker import check_health, log, read_config, run_worker


async def main() -> int:
    config = read_config(os.environ)
    if sys.argv[1:] == ["--health"]:
        return 0 if await check_health(config) else 1
    if sys.argv[1:]:
        raise ValueError("Unexpected arguments")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: loop.call_soon_threadsafe(stop.set))
    await run_worker(config, stop)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except (Exception, KeyboardInterrupt):  # noqa: BLE001 - never expose credentials in tracebacks
        log("analytics.startup_or_runtime_failed")
        sys.exit(1)
