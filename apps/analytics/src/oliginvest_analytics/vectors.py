"""Load canonical A–H fixtures without copying data or coercing decimal text."""

import json
import math
import re
from pathlib import Path
from typing import cast

type VectorValue = str | int | float | None | list[VectorValue] | dict[str, VectorValue]
type TestVectors = dict[str, dict[str, VectorValue]]

VECTOR_KEYS = (
    "A_fifo_fx",
    "B_twr_xirr",
    "C_drawdown",
    "D_risk",
    "E_indicators_talib",
    "F_day_change",
    "G_dividend",
    "H_rebalance",
)

# obliczenia-finansowe.md § 0.5; no rounding or calculations in the loader.
TOLERANCES: dict[str, str | float] = {
    "settlementAmount": "0",
    "returnsRelative": 1e-9,
    "xirrAbsolute": 1e-6,
    "riskMetrics": 1e-6,
    "indicators": 1e-8,
}


def read_decimal_text(value: object) -> str:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?", value) is None
    ):
        raise TypeError("Expected decimal text; floating-point amounts are forbidden")
    return value


def read_statistic(value: object) -> int | float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise TypeError(
            "Expected a numeric statistic; decimal text must not become a float"
        )
    return value


def _validate_value(value: object, path: str) -> None:
    if isinstance(value, bool):
        raise TypeError(f"Invalid reference value at {path}")
    if isinstance(value, (int, float)):
        if path.split(".")[0] not in VECTOR_KEYS[2:5] and path != "B_twr_xirr.days":
            raise TypeError(
                f"Expected text at {path}; floating-point amounts are forbidden"
            )
        read_statistic(value)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_value(item, f"{path}.{index}")
    elif isinstance(value, dict):
        for key, item in value.items():
            _validate_value(item, f"{path}.{key}")
    elif value is not None and not isinstance(value, str):
        raise TypeError(f"Invalid reference value at {path}")


def load_test_vectors() -> TestVectors:
    # Test support in a repository checkout; never ship a second fixture in wheels.
    source = Path(__file__).resolve().parents[4] / "docs/03-dane/wektory-testowe.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"_meta", *VECTOR_KEYS}:
        raise TypeError("Expected metadata and exactly vectors A–H")
    for key, value in data.items():
        if not isinstance(value, dict):
            raise TypeError(f"Expected object at {key}")
        _validate_value(value, key)
    return cast(TestVectors, data)
