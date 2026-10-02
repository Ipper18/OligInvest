"""Host operations with synthetic inputs: no servers, credentials or notifications."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("operations", Path(__file__).resolve().parents[1] / "scripts/host-operations.py")
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class HostOperationTests(unittest.TestCase):
    def test_backup_checks_only_after_success(self):
        for kind in ("full", "diff"):
            calls = []
            ops.perform("backup-" + kind, ["compose"], calls.append)
            self.assertEqual(calls[-2][-2:], ["--type=" + kind, "backup"])
            self.assertEqual(calls[-1][-1], "check")
            calls.clear()
            def execute(command):
                calls.append(command)
                if command[-1] == "backup":
                    raise RuntimeError("synthetic failure")
            with self.assertRaises(RuntimeError):
                ops.perform("backup-" + kind, ["compose"], execute)
            self.assertFalse(any(c[-1] == "check" for c in calls))

    def test_missing_hdd_prevents_all_work(self):
        rest = []
        with self.assertRaises(RuntimeError):
            ops.perform("backup-offsite", [], lambda _: (_ for _ in ()).throw(RuntimeError()), rest.append)
        self.assertEqual(rest, [])

    def test_storage_rejects_default_docker_volume_even_if_hdd_exists(self):
        def execute(command):
            source = ops.BACKUP / "pgbackrest" if command[-1].endswith("backup-data") else ops.CADDY
            return json.dumps([{"Driver": "local", "Options": {"device": str(source), "type": "none", "o": "bind"}}])
        ops.validate_storage(execute)
        with self.assertRaises(ValueError):
            ops.validate_storage(lambda _: json.dumps([{"Driver": "local", "Options": None}]))

    def test_offsite_sources_exclude_application_secrets_and_require_erasure_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pgbackrest").mkdir()
            (root / "caddy").mkdir()
            calls = []
            with patch.object(ops, "BACKUP", root), patch.object(ops, "CADDY", root / "caddy"):
                with self.assertRaises(ValueError):
                    ops.perform("backup-offsite", [], lambda _: None, calls.append)
                (root / "erasure-log.jsonl").touch()
                ops.perform("backup-offsite", [], lambda _: None, calls.append)
            self.assertEqual(calls[0][-3:], [str(root / "pgbackrest"), str(root / "caddy"), str(root / "erasure-log.jsonl")])

    def test_credentials_never_enter_restic_arguments(self):
        calls = []
        def execute(command, **kwargs):
            calls.append((command, kwargs))
        with patch.object(ops, "secret", return_value="synthetic-private"):
            ops.restic(["check"], execute)
        self.assertEqual(calls[0][0], ["restic", "check"])
        self.assertEqual(calls[0][1]["env"]["RESTIC_REST_PASSWORD"], "synthetic-private")
        self.assertNotIn("RESTIC_PASSWORD", calls[0][1]["env"])

    def test_health_detects_resources_clock_and_missing_containers(self):
        services = ("postgres", "valkey-queue", "valkey-cache", "caddy", "api", "web", "jobs", "analytics")
        containers = [{"Service": s, "State": "running", "Health": "healthy"} for s in services]
        memory = "MemTotal: 1000 kB\nMemAvailable: 500 kB\n"
        clock = "System time : 0.001 seconds slow of NTP time\nLeap status : Normal"
        self.assertTrue(ops.vm_healthy(containers, clock, memory, [(40, 100)]))
        for data, time, mem, disk in ((containers[:-1], clock, memory, [(40, 100)]),
                                       (containers, clock.replace("0.001", "3.0"), memory, [(40, 100)]),
                                       (containers, clock.replace("Normal", "Not synchronised"), memory, [(40, 100)]),
                                       (containers, clock, memory.replace("500", "50"), [(40, 100)]),
                                       (containers, clock, memory, [(81, 100)])):
            self.assertFalse(ops.vm_healthy(data, time, mem, disk))

    def test_verification_failure_never_refreshes_backup_success(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(ops, "CONFIG", Path(directory)), \
             patch.object(ops, "compose", return_value=[]), patch.object(ops, "validate_storage"), patch.object(ops, "perform", side_effect=RuntimeError("private")), \
             patch.object(ops, "heartbeat") as beat, patch.object(ops, "run"), \
             patch("sys.argv", ["host-operations.py", "verify"]):
            with self.assertRaises(SystemExit):
                ops.main()
            beat.assert_called_once_with("verify", False)

    def test_heartbeat_suppresses_redirect_and_contains_no_diagnostics(self):
        with patch.object(ops, "secret", return_value="http://kuma.example.test/api/push/synthetic?status=up&msg=private"), \
             patch.object(ops.urllib.request, "build_opener") as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.read.return_value = json.dumps({"ok": True}).encode()
            ops.heartbeat("vm-health", False)
            url = factory.return_value.open.call_args.args[0]
            self.assertTrue(url.endswith("status=down&msg=FAIL"))
            self.assertNotIn("private", url)
            self.assertIsInstance(factory.call_args.args[1], ops.NoRedirect)
            self.assertIsNone(ops.NoRedirect().redirect_request(None))


if __name__ == "__main__":
    unittest.main()
