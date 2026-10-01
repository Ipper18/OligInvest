import importlib


def test_package_imports_without_starting_a_worker() -> None:
    package = importlib.import_module("oliginvest_analytics")
    assert package.__name__ == "oliginvest_analytics"
