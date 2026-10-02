"""No network / daemon: security and deployment ordering failure tests."""
import importlib.util
import base64
import json
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

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

    def test_each_recreation_failure_restores_data_before_applications(self):
        services = ("postgres", "valkey-queue", "valkey-cache", "api", "jobs", "analytics", "web", "caddy")
        for failed in services:
            with self.subTest(service=failed):
                calls = []
                def execute(command):
                    calls.append(command)
                    if command[0] == "candidate" and "up" in command and command[-1] == failed:
                        raise RuntimeError("sensitive tool output")
                with self.assertRaises(deploy.StepError) as caught:
                    deploy.activate(["candidate"], ["previous"], execute, lambda *_: None)
                restored = [c[-1] for c in calls if c[0] == "previous" and "up" in c]
                self.assertEqual(restored, list(services))
                self.assertEqual(caught.exception.step, "activate-" + failed)
                migration = next(c for c in calls if c[-1] == "migrate")
                self.assertIn("--no-deps", migration)

    def test_failure_log_contains_step_but_no_exception_output(self):
        calls = []
        error = deploy.StepError("activate-postgres")
        error.__cause__ = RuntimeError("password=synthetic-sensitive-value")
        deploy.log_failure(error, calls.append)
        self.assertEqual(calls, [["logger", "--tag", "oliginvest", "--priority", "user.err", "system.deploy failed step=activate-postgres"]])
        with patch.object(deploy, "run", side_effect=OSError("sensitive")):
            deploy.log_failure(error)

    def test_rollback_failure_preserves_original_step(self):
        def execute(command):
            if "up" in command:
                raise RuntimeError("private output")
        with self.assertRaises(deploy.StepError) as caught:
            deploy.activate(["candidate"], ["previous"], execute)
        calls = []
        deploy.log_failure(caught.exception, calls.append)
        self.assertIn("step=activate-postgres rollback_step=rollback-postgres", calls[0][-1])

    def test_wrapped_steps_and_unknown_errors_do_not_leak_output(self):
        for name in ("download", "verify-package", "backup", "migrate", "provision-secrets", "audit", "publish-current"):
            with self.assertRaises(deploy.StepError) as caught:
                deploy.step(name, lambda: (_ for _ in ()).throw(RuntimeError("private output")))
            calls = []
            deploy.log_failure(caught.exception, calls.append)
            self.assertEqual(calls[0][-1], "system.deploy failed step=" + name)
        calls = []
        deploy.log_failure(RuntimeError("private output"), calls.append)
        self.assertEqual(calls[0][-1], "system.deploy failed step=preflight")

    def test_retry_archives_only_inactive_candidate_without_touching_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / "releases/v1.2.3"
            candidate.mkdir(parents=True)
            (candidate / "images.lock").write_text("evidence")
            volume = root / "data"
            volume.write_text("preserved")
            with self.assertRaises(ValueError):
                deploy.prepare_candidate(root, candidate, None, False)
            with self.assertRaises(ValueError):
                deploy.prepare_candidate(root, candidate, candidate, True)
            deploy.prepare_candidate(root, candidate, None, True)
            self.assertFalse(candidate.exists())
            self.assertEqual(next((root / "failed").glob("*/release/images.lock")).read_text(), "evidence")
            self.assertEqual(volume.read_text(), "preserved")
            candidate.symlink_to(root / "data")
            with self.assertRaises(ValueError):
                deploy.prepare_candidate(root, candidate, None, True)

    def test_storage_override_is_used_for_both_candidate_and_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory)
            storage = config / "storage-compose.yaml"
            storage.touch(mode=0o600)
            for release in (Path("/opt/oliginvest/releases/v1.2.3"), Path("/opt/oliginvest/releases/v1.2.2")):
                self.assertEqual(deploy.compose_args(release, config)[-2:], ["-f", str(storage)])
            storage.chmod(0o666)
            with self.assertRaises(ValueError):
                deploy.compose_args(Path("/candidate"), config)

    def test_retry_can_publish_after_interrupted_pointer_update(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = root / "releases/v1.2.2"
            candidate = root / "releases/v1.2.3"
            previous.mkdir(parents=True)
            candidate.mkdir()
            (root / "current").symlink_to(previous)
            (root / ".current-pending").symlink_to(candidate)
            deploy.publish_current(root, candidate)
            self.assertEqual((root / "current").resolve(), candidate)
            self.assertFalse((root / ".current-pending").exists())
            (root / ".current-pending").write_text("preserve unexpected file")
            with self.assertRaises(ValueError):
                deploy.publish_current(root, candidate)

    def test_retry_reverifies_package_and_all_images_before_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "application"
            config = Path(directory) / "config"
            candidate = root / "releases/v1.2.3"
            previous = root / "releases/v1.2.2"
            candidate.mkdir(parents=True)
            previous.mkdir()
            (candidate / "evidence").write_text("preserved")
            (root / "current").symlink_to(previous)
            document = {"version": "v1.2.3", "commit": "a" * 40, "images": {s: f"ghcr.io/ipper18/oliginvest-{s}@sha256:" + "b" * 64 for s in deploy.SERVICES}}
            statement = {"predicate": {"buildDefinition": {"resolvedDependencies": [{"digest": {"gitCommit": "a" * 40}}]}, "runDetails": {"builder": {"id": deploy.identity("v1.2.3")}}}}
            envelope = json.dumps({"payload": base64.b64encode(json.dumps(statement).encode()).decode()})
            calls = []
            def execute(command):
                calls.append(command)
                return envelope if "verify-attestation" in command else ""
            def unpack(_archive, destination):
                (destination / "images.lock").write_text(json.dumps(document))
            def activate(*_):
                self.assertEqual(sum("verify-blob" in c for c in calls), 1)
                self.assertEqual(sum("verify" in c for c in calls), len(deploy.SERVICES))
                self.assertEqual(sum("verify-attestation" in c for c in calls), len(deploy.SERVICES))
            with patch("sys.argv", ["deploy.py", "v1.2.3", "--retry-staged", "--root", str(root), "--config", str(config)]), \
                 patch.object(deploy, "download_assets") as download, patch.object(deploy, "unpack", side_effect=unpack), \
                 patch.object(deploy, "run", side_effect=execute), patch.object(deploy, "provision"), \
                 patch.object(deploy, "activate", side_effect=activate) as activation, patch.object(deploy, "notify_owner"):
                deploy.main()
                download.assert_called_once()
                activation.assert_called_once()
            self.assertEqual(next((root / "failed").glob("*/release/evidence")).read_text(), "preserved")
            self.assertEqual((root / "current").resolve(), candidate)


if __name__ == "__main__":
    unittest.main()
