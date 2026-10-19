"""Computation process: one validated job on stdin, one outcome on stdout.

Runs as `python -I -m oliginvest_analytics.runner` without secrets in its environment,
so the parent can enforce the per-type wall-clock limit by killing it (ADR-003 § 5).
"""

import json
import sys
from collections.abc import Callable, Mapping
from typing import Any

type Handler = Callable[[Mapping[str, Any]], Mapping[str, Any]]

# Analyses register here (BL-313 and later); BL-311 ships the contract only.
HANDLERS: dict[str, Handler] = {}


def run(raw: bytes, handlers: Mapping[str, Handler] = HANDLERS) -> dict[str, Any]:
    request = json.loads(raw)
    handler = handlers.get(request["type"])
    if handler is None:
        return {"status": "failed", "code": "INTERNAL"}
    try:
        return {"status": "done", "result": dict(handler(request["job"]))}
    except MemoryError:
        return {"status": "failed", "code": "MEMORY_LIMIT"}
    except Exception:  # noqa: BLE001 - details may contain user parameters
        return {"status": "failed", "code": "INTERNAL"}


def main() -> None:
    outcome = run(sys.stdin.buffer.read())
    sys.stdout.write(json.dumps(outcome, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
