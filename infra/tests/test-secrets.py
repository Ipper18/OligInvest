"""Linux integration tests; synthetic credentials only."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "secret-files.py"
spec = importlib.util.spec_from_file_location("secrets_tool", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SecretTests(unittest.TestCase):
    def test_auth_state_is_private_to_api(self):
        values = {f"VALKEY_QUEUE_{name}_PASSWORD": b"synthetic-secret" for name in ["API", "JOBS", "ANALYTICS"]}
        lines = module.acl(values).decode().splitlines()
        self.assertIn("~auth:*", next(line for line in lines if line.startswith("user api ")))
        for service in ["jobs", "analytics"]:
            self.assertNotIn("~auth:*", next(line for line in lines if line.startswith(f"user {service} ")))

    def test_matrix_is_strict(self):
        text = module.INF.read_text()
        self.assertEqual(len(module.matrix(text)), 9)
        with self.assertRaises(ValueError):
            module.matrix(text.replace("| web | 1000 |", "| web | root |"))
        with self.assertRaises(ValueError):
            module.matrix(text.replace("| web | 1000 |", "| api | 1000 |"))

    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() == 0, "Linux root harness")
    def test_idempotence_rotation_and_host_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = ["python3", str(SCRIPT), "--root", str(root)]
            first = subprocess.run(command, capture_output=True, check=True)
            originals = {p.name: p.read_bytes() for p in (root / "secrets").iterdir()}
            self.assertFalse(any(value in first.stdout + first.stderr for value in originals.values()))
            subprocess.run(command, capture_output=True, check=True)
            self.assertEqual(originals, {p.name: p.read_bytes() for p in (root / "secrets").iterdir()})
            for service, row in module.matrix().items():
                actual = root / "runtime-secrets" / service
                self.assertEqual(set(p.name for p in actual.iterdir()), set(row["required"]))
                for path in actual.iterdir():
                    self.assertEqual(path.stat().st_uid, row["uid"])
                    self.assertEqual(path.stat().st_gid, row["gid"])
                    self.assertEqual(path.stat().st_mode & 0o777, 0o400)
            probe = subprocess.run(["setpriv", "--reuid=10001", "--regid=10001", "--clear-groups", "test", "-r", str(root / "runtime-secrets/analytics/DB_ANALYTICS_RO_PASSWORD")])
            self.assertNotEqual(probe.returncode, 0)
            previous = (root / "runtime-secrets/api/AUDIT_PSEUDONYM_KEY").open("rb")
            try:
                new_value = b"synthetic-rotated-value-012345678901234567890"
                (root / "secrets/AUDIT_PSEUDONYM_KEY").write_bytes(new_value)
                subprocess.run(command, capture_output=True, check=True)
                for service in ("api", "jobs"):
                    self.assertEqual((root / "runtime-secrets" / service / "AUDIT_PSEUDONYM_KEY").read_bytes(), new_value)
                self.assertEqual(previous.read(), originals["AUDIT_PSEUDONYM_KEY"])
            finally:
                previous.close()
            victim = root / "outside"
            victim.write_text("untouched")
            original = root / "secrets/DB_APP_PASSWORD"
            original.unlink()
            original.symlink_to(victim)
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(victim.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()

