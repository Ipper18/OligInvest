"""No network / daemon: security and deployment ordering failure tests."""
import importlib.util
import base64
import json
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).resolve().parents[1] / "scripts/deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_provenance_requires_locked_commit_and_workflow(self):
        statement = {"predicate": {"buildDefinition": {"resolvedDependencies": [{"digest": {"gitCommit": "a" * 40}}]}, "runDetails": {"builder": {"id": deploy.identity("v1.2.3")}}}}
        envelope = {"payload": base64.b64encode(json.dumps(statement).encode()).decode()}
        for output in [json.dumps(envelope), json.dumps([envelope]), json.dumps(envelope) + "\n" + json.dumps(envelope)]:
            deploy.verify_provenance(output, {"commit": "a" * 40}, "v1.2.3")
            with self.assertRaises(ValueError):
                deploy.verify_provenance(output, {"commit": "b" * 40}, "v1.2.3")
            with self.assertRaises(ValueError):
                deploy.verify_provenance(output, {"commit": "a" * 40}, "v9.9.9")

    def test_archive_rejects_traversal_and_links(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("infra/link", tarfile.SYMTYPE), ("extra", tarfile.REGTYPE)]:
            with tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / "package.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    info = tarfile.TarInfo(name)
                    info.type = kind
                    info.size = 1 if kind == tarfile.REGTYPE else 0
                    bundle.addfile(info, io.BytesIO(b"x"))
                with self.assertRaises(ValueError):
                    deploy.unpack(archive, Path(directory) / "unpacked")

    def test_lock_rejects_wrong_registry_missing_image_and_mutable_tag(self):
        valid = {"version": "v1.2.3", "commit": "a" * 40, "images": {s: f"ghcr.io/ipper18/oliginvest-{s}@sha256:" + "b" * 64 for s in deploy.SERVICES}}
        deploy.validate_images(valid, "v1.2.3")
        for value in ["ghcr.io/other/api@sha256:" + "b" * 64, "ghcr.io/ipper18/oliginvest-api:latest"]:
            with self.assertRaises(ValueError):
                deploy.validate_images({**valid, "images": {**valid["images"], "api": value}}, "v1.2.3")

    def test_backup_precedes_migration_and_failure_prevents_recreation(self):
        calls = []
        def execute(command):
            calls.append(command)
            if command[-1] == "migrate":
                raise RuntimeError("synthetic migration failure")
        with self.assertRaises(RuntimeError):
            deploy.activate(["candidate"], ["previous"], execute)
        self.assertEqual([call[-1] for call in calls], ["backup", "check", "migrate"])
        self.assertEqual(calls[0][0], "previous")

    def test_failed_health_rolls_back_application_without_down_migrations(self):
        calls = []
        def gate(command, execute):
            if command[0] == "candidate":
                raise RuntimeError("synthetic health failure")
        with self.assertRaises(RuntimeError):
            deploy.activate(["candidate"], ["previous"], calls.append, gate)
        self.assertEqual(calls[-1][0], "previous")
        self.assertIn("up", calls[-1])
        self.assertNotIn("migrate", calls[-1])
        self.assertFalse(any("down" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
