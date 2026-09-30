"""Offline regression checks for the blocking audit policy."""

import copy
import datetime as dt
import runpy
import unittest
from pathlib import Path

audit = runpy.run_path(str(Path(__file__).with_name("deps-audit.py")))


class PolicyTests(unittest.TestCase):
    def report(self, score="7.0"):
        package = {
            "package": {"ecosystem": "npm", "name": "sample", "version": "1"},
            "groups": [
                {"ids": ["GHSA-test"], "aliases": ["CVE-test"], "max_severity": score}
            ],
            "vulnerabilities": [{"id": "GHSA-test"}],
        }
        return {
            "results": [
                {"source": {"path": "pnpm-lock.yaml"}, "packages": [package]},
                {
                    "source": {"path": "apps/analytics/uv.lock"},
                    "packages": [
                        {
                            "package": {
                                "ecosystem": "PyPI",
                                "name": "other",
                                "version": "2",
                            }
                        }
                    ],
                },
            ]
        }

    def test_severity_threshold_including_unfixed(self):
        for score, blocked in [("6.9", False), ("7.0", True), ("9.5", True)]:
            rows, _ = audit["findings"](self.report(score), {})
            self.assertEqual(any(row[3] >= 7 and not row[4] for row in rows), blocked)

    def test_alias_exception(self):
        rows, _ = audit["findings"](self.report(), {"CVE-test": {}})
        self.assertEqual(rows[0][4], "CVE-test")

    def test_bad_or_missing_severity_fails(self):
        for score in ["", "NaN", "inf", "10.1", "unknown"]:
            with self.assertRaises(ValueError):
                audit["findings"](self.report(score), {})
        data = self.report()
        del data["results"][0]["packages"][0]["groups"]
        with self.assertRaises(ValueError):
            audit["findings"](data, {})

    def test_empty_and_partial_reports_fail(self):
        for data in [{}, {"results": []}, {"results": self.report()["results"][:1]}]:
            with self.assertRaises(ValueError):
                audit["findings"](data, {})

    def test_exception_date_rationale_and_maximum(self):
        entry = {
            "id": "GHSA-test",
            "reason": "approved=2026-09-21; R-24: owner reviewed the unused dev server",
            "ignoreUntil": dt.date(2026, 12, 20),
        }
        today = dt.date(2026, 9, 30)
        self.assertIn(
            "GHSA-test", audit["exceptions"]({"IgnoredVulns": [entry]}, today)
        )
        for updates in [
            {"ignoreUntil": today},
            {"ignoreUntil": dt.date(2026, 12, 21)},
            {"reason": "approved=2026-10-01; R-24: future approval cannot be used"},
            {"reason": "R-24: missing decision date"},
        ]:
            with self.assertRaises(ValueError):
                audit["exceptions"]({"IgnoredVulns": [{**entry, **updates}]}, today)
        with self.assertRaises(ValueError):
            audit["exceptions"]({"IgnoredVulns": [entry, entry]}, today)
        with self.assertRaises(ValueError):
            audit["exceptions"]({"PackageOverrides": []}, today)

    def test_spdx_operators_and_unknown(self):
        for expression, allowed in [
            ("MIT", True),
            ("MIT OR GPL-3.0-only", True),
            ("MIT AND GPL-3.0-only", False),
            ("(MIT OR Apache-2.0) AND BSD-3-Clause", True),
            ("UNKNOWN", False),
            ("AGPL-3.0-only", False),
        ]:
            self.assertEqual(audit["license_allowed"](expression, "sample"), allowed)
        for expression in [
            "",
            "MIT OR",
            "MIT garbage",
            "(MIT",
            "MIT;GPL",
            "MIT WITH Exception",
        ]:
            with self.assertRaises(ValueError):
                audit["license_allowed"](expression, "sample")
        self.assertFalse(audit["license_allowed"]("Python-2.0", "sample"))
        self.assertTrue(audit["license_allowed"]("Python-2.0", "argparse"))
        self.assertFalse(audit["license_allowed"]("LGPL-3.0-only", "sample"))

    def test_sbom_missing_license_and_missing_package_fail(self):
        sbom = {
            "bomFormat": "CycloneDX",
            "components": [
                {
                    "name": "sample",
                    "version": "1",
                    "purl": "pkg:npm/sample@1",
                    "licenses": [{"license": {"id": "MIT"}}],
                }
            ],
        }
        expected = {("npm", "sample", "1")}
        self.assertEqual(audit["licenses"](sbom, expected)[0], [])
        with self.assertRaises(ValueError):
            audit["licenses"](sbom, expected | {("PyPI", "missing", "2")})
        unknown = copy.deepcopy(sbom)
        del unknown["components"][0]["licenses"]
        self.assertTrue(audit["licenses"](unknown, expected)[0])


if __name__ == "__main__":
    unittest.main()
