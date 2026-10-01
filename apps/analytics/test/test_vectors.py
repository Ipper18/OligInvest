import json
import shutil
import subprocess
from pathlib import Path

import pytest

from oliginvest_analytics.vectors import (
    TOLERANCES,
    VECTOR_KEYS,
    load_test_vectors,
    read_decimal_text,
    read_statistic,
)

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs/03-dane/wektory-testowe.json"


def assert_identical(actual: object, expected: object) -> None:
    """Compare every key, array length, scalar type and exact decimal text."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict)
        assert actual.keys() == expected.keys()
        for key, value in expected.items():
            assert_identical(actual[key], value)
    elif isinstance(expected, list):
        assert isinstance(actual, list)
        assert len(actual) == len(expected)
        for item, value in zip(actual, expected, strict=True):
            assert_identical(item, value)
    elif type(expected) in (int, float):
        # JSON numbers have one type in JS; JSON.stringify may emit 0.0 as 0.
        assert type(actual) in (int, float)
        assert actual == expected
    else:
        assert type(actual) is type(expected)
        assert actual == expected


def test_loaders_match_source_and_each_other_from_another_cwd(tmp_path, monkeypatch):
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    monkeypatch.chdir(tmp_path)
    python_vectors = load_test_vectors()
    assert len(VECTOR_KEYS) == 8
    assert list(python_vectors) == ["_meta", *VECTOR_KEYS]
    assert_identical(python_vectors, source)
    node = shutil.which("node")
    assert node is not None, "Node 24 is required for TS/Python vector parity"
    module_url = (ROOT / "packages/test-vectors/src/index.ts").as_uri()
    result = subprocess.run(
        [
            node,
            "--input-type=module",
            "-e",
            (
                f"import {{ loadTestVectors, TOLERANCES }} from {json.dumps(module_url)}; "
                "console.log(JSON.stringify({vectors: loadTestVectors(), tolerances: TOLERANCES}));"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    typescript = json.loads(result.stdout)
    assert_identical(typescript["vectors"], python_vectors)
    assert typescript["tolerances"] == TOLERANCES


def test_decimal_text_and_numeric_read_guards():
    vectors = load_test_vectors()
    assert read_decimal_text(vectors["G_dividend"]["wht_usd"]) == "3.7500"
    assert read_decimal_text("9007199254740993.00000001") == "9007199254740993.00000001"
    with pytest.raises(TypeError):
        read_statistic(vectors["G_dividend"]["wht_usd"])
    for invalid in (3.75, None, True, "", "0.54%", "NaN"):
        with pytest.raises(TypeError):
            read_decimal_text(invalid)
    assert read_statistic(vectors["D_risk"]["sharpe_rf0"]) == 1.885912
    for invalid in (None, True, "1.5", float("nan"), float("inf")):
        with pytest.raises(TypeError):
            read_statistic(invalid)


def test_numeric_amount_in_source_is_rejected(monkeypatch):
    corrupted = load_test_vectors()
    corrupted["G_dividend"]["gross_usd"] = 25.0
    monkeypatch.setattr(
        Path, "read_text", lambda *args, **kwargs: json.dumps(corrupted)
    )
    with pytest.raises(TypeError, match="G_dividend.gross_usd"):
        load_test_vectors()


def test_each_load_is_independent():
    vectors = load_test_vectors()
    vectors["G_dividend"]["gross_usd"] = "changed"
    assert load_test_vectors()["G_dividend"]["gross_usd"] == "25.00"


def test_parity_check_detects_float_coercion_and_missing_keys():
    source = load_test_vectors()
    corrupted = load_test_vectors()
    corrupted["G_dividend"]["gross_usd"] = 25.0
    with pytest.raises(AssertionError):
        assert_identical(corrupted, source)
    corrupted = load_test_vectors()
    del corrupted["H_rebalance"]["current"]
    with pytest.raises(AssertionError):
        assert_identical(corrupted, source)
