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

    def test_cdn_advisory_metadata_is_narrow_and_fail_closed(self):
        metadata = {"version": "0.20.3", "license": "Apache-2.0"}
        for identity, fixed in audit["SHEETJS_FIXED"].items():
            data = self.report("7.8")
            item = data["results"][0]["packages"][0]
            item["package"] = {"ecosystem": "npm", "name": "xlsx", "version": "0.20.3"}
            item["groups"][0]["ids"] = [identity]
            item["vulnerabilities"] = [
                {
                    "id": identity,
                    "affected": [
                        {
                            "package": {"ecosystem": "npm", "name": "xlsx"},
                            "database_specific": {
                                "last_known_affected_version_range": f"< {fixed}"
                            },
                            "ranges": [
                                {"events": [{"introduced": "0"}], "type": "SEMVER"}
                            ],
                        }
                    ],
                }
            ]
            corrected = []
            self.assertEqual(audit["findings"](data, {}, metadata, corrected)[0], [])
            self.assertEqual(len(corrected), 1)
            self.assertEqual(len(audit["findings"](data, {})[0]), 1)
            item["package"]["version"] = "0.18.5"
            self.assertEqual(len(audit["findings"](data, {}, metadata)[0]), 1)
            item["package"]["version"] = "0.20.3"
            item["vulnerabilities"][0]["affected"][0]["database_specific"] = {}
            self.assertEqual(len(audit["findings"](data, {}, metadata)[0]), 1)
        data = self.report("9.8")
        data["results"][0]["packages"][0]["package"] = item["package"]
        self.assertEqual(len(audit["findings"](data, {}, metadata)[0]), 1)

    def test_cdn_sbom_version_license_and_integrity(self):
        component = {
            "name": "xlsx",
            "version": audit["SHEETJS_URL"],
            "purl": "pkg:npm/xlsx@https%3A",
        }
        sbom = {"bomFormat": "CycloneDX", "components": [component]}
        expected = {("npm", "xlsx", "0.20.3")}
        with self.assertRaises(ValueError):
            audit["licenses"](copy.deepcopy(sbom), expected)
        rejected, normalized = audit["licenses"](
            sbom, expected, {"version": "0.20.3", "license": "Apache-2.0"}
        )
        self.assertEqual(rejected, [])
        self.assertEqual(len(normalized), 1)
        self.assertEqual(component["purl"], "pkg:npm/xlsx@0.20.3")
        for lock in [
            "",
            (Path(__file__).resolve().parent.parent / "pnpm-lock.yaml").read_text(),
        ]:
            with self.assertRaises(ValueError):
                audit["sheetjs_metadata"](lock, b"tampered")

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
            ("BlueOak-1.0.0", True),
            ("BlueOak-1.0.0 AND GPL-3.0-only", False),
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
        sbom["components"].append({"type": "file", "name": "/source/pnpm-lock.yaml"})
        self.assertEqual(audit["licenses"](sbom, expected)[0], [])
        with self.assertRaises(ValueError):
            audit["licenses"](sbom, expected | {("PyPI", "missing", "2")})
        unknown = copy.deepcopy(sbom)
        del unknown["components"][0]["licenses"]
        self.assertTrue(audit["licenses"](unknown, expected)[0])


if __name__ == "__main__":
    unittest.main()
