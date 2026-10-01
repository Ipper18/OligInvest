"""Image policy regression tests; lockfile policy is independent and unchanged."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("image_audit", Path(__file__).resolve().parents[2] / "scripts/image-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def report(score="9.8", fixed=True, urgency=None, ecosystem="Debian:13"):
    affected = {"package": {"ecosystem": ecosystem, "name": "sample"}, "ranges": [{"events": [{"introduced": "0"}, *([{"fixed": "2"}] if fixed else [])]}]}
    if urgency:
        affected["ecosystem_specific"] = {"urgency": urgency}
    return {"results": [{"packages": [{"package": {"ecosystem": "Debian:13", "name": "sample"}, "groups": [{"ids": ["TEST-1"], "max_severity": score}], "vulnerabilities": [{"id": "TEST-1", "affected": [affected]}]}]}]}


class ImagePolicyTests(unittest.TestCase):
    def test_fixable_critical_blocks(self):
        self.assertEqual(audit.assess(report(), set()), ["TEST-1"])

    def test_image_gate_is_critical_with_fix_for_same_distribution(self):
        self.assertEqual(audit.assess(report("8.9"), set()), [])
        self.assertEqual(audit.assess(report(fixed=False), set()), [])
        self.assertEqual(audit.assess(report(ecosystem="Debian:14"), set()), [])

    def test_unknown_score_is_rejected_except_explicit_distribution_classification(self):
        for value in ["", "NaN", "Infinity", "11"]:
            with self.assertRaises(ValueError):
                audit.assess(report(value), set())
        self.assertEqual(audit.assess(report("", urgency="unimportant"), set()), [])
        with self.assertRaises(ValueError):
            audit.assess(report("", urgency="unimportant", ecosystem="Debian:14"), set())

    def test_empty_scan_is_rejected(self):
        with self.assertRaises(ValueError):
            audit.assess({"results": []}, set())


if __name__ == "__main__":
    unittest.main()
