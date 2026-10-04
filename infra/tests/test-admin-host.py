"""Synthetic host commands: no running service is changed."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("admin_host", Path(__file__).resolve().parents[1] / "scripts/admin-host.py")
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


class AdminHostTests(unittest.TestCase):
    def test_audit_precedes_switch_and_success_follows_reload(self):
        for action in ("on", "off"):
            calls = []
            def execute(command):
                calls.append(command)
                return "off"
            admin.maintenance(["compose"], action, "Synthetic reason", execute)
            self.assertEqual(calls[0][-2:], ["--outcome", "started"])
            self.assertEqual(calls[2][-1], admin.ENABLE if action == "on" else admin.DISABLE)
            self.assertEqual(calls[-2][-1], admin.RELOAD)
            self.assertEqual(calls[-1][-2:], ["--outcome", "success"])

    def test_audit_failure_prevents_switch(self):
        calls = []
        def execute(command):
            calls.append(command)
            raise RuntimeError("synthetic audit failure")
        with self.assertRaises(RuntimeError):
            admin.maintenance([], "on", "Synthetic reason", execute)
        self.assertEqual(len(calls), 1)

    def test_reload_failure_restores_previous_state_and_audits_error(self):
        calls = []
        def execute(command):
            calls.append(command)
            if len(calls) == 4:
                raise RuntimeError("synthetic reload failure")
            return "on"
        with self.assertRaises(RuntimeError):
            admin.maintenance([], "off", "Synthetic reason", execute)
        self.assertEqual(calls[4][-1], admin.ENABLE)
        self.assertEqual(calls[-1][-1], "error")

    def test_rejects_bad_input_before_any_effect(self):
        for action, reason in (("bad", "valid reason"), ("on", "")):
            with self.assertRaises(ValueError):
                admin.maintenance([], action, reason, lambda _: self.fail("Unexpected command"))


if __name__ == "__main__":
    unittest.main()
