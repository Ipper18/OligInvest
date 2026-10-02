"""Pull deployment. No server access from CI; signatures precede extraction/execution."""
import argparse
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import urllib.request

REPOSITORY = "Ipper18/OligInvest"
ISSUER = "https://token.actions.githubusercontent.com"
SERVICES = {"web", "api", "jobs", "analytics", "postgres", "migrate", "caddy", "valkey-queue", "valkey-cache"}
ACTIVE_SERVICES = ("postgres", "valkey-queue", "valkey-cache", "api", "jobs", "analytics", "web", "caddy")


class StepError(RuntimeError):
    def __init__(self, step):
        super().__init__(step)
        self.step = step
        self.rollback_step = None


def step(name, function, *args):
    try:
        return function(*args)
    except StepError:
        raise
    except Exception as error:
        raise StepError(name) from error


def log_failure(error, execute=None):
    # Only fixed step names, never exception strings, argv, paths or tool output.
    name = error.step if isinstance(error, StepError) else "preflight"
    suffix = f" rollback_step={error.rollback_step}" if isinstance(error, StepError) and error.rollback_step else ""
    try:
        (execute or run)(["logger", "--tag", "oliginvest", "--priority", "user.err", f"system.deploy failed step={name}{suffix}"])
    except Exception:
        pass


def prepare_candidate(root, candidate, previous, retry):
    if candidate.is_symlink() or candidate.parent != root / "releases":
        raise ValueError("Invalid candidate path")
    if not candidate.exists():
        return
    if not retry or candidate == previous or not candidate.is_dir():
        raise ValueError("Release already staged or active; inspect before retrying")
    failed = root / "failed"
    if failed.is_symlink():
        raise ValueError("Invalid diagnostic directory")
    failed.mkdir(mode=0o700, exist_ok=True)
    archive = Path(tempfile.mkdtemp(prefix=candidate.name + "-", dir=failed))
    candidate.rename(archive / "release")


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, timeout=600, **kwargs)
    if result.returncode:
        # Tool output may contain local paths or credentials: do not echo it.
        raise RuntimeError(f"Deployment command failed: {args[0]}")
    return result.stdout


def download_assets(directory, version):
    for name in ("oliginvest.tar.gz", "oliginvest.sigstore.json"):
        with urllib.request.urlopen(f"https://github.com/{REPOSITORY}/releases/download/{version}/{name}", timeout=60) as response:
            content = response.read(12 * 1024 * 1024 + 1)
        if len(content) > 12 * 1024 * 1024:
            raise ValueError("Oversized download")
        (directory / name).write_bytes(content)


def provision(candidate, config):
    spec = importlib.util.spec_from_file_location("secret_files", candidate / "infra/scripts/secret-files.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.provision(config)


def unpack(archive, destination):
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 500 or sum(m.size for m in members) > 10 * 1024 * 1024:
            raise ValueError("Oversized deployment package")
        names = set()
        for item in members:
            path = Path(item.name)
            if not item.isfile() or path.is_absolute() or ".." in path.parts or item.name in names:
                raise ValueError("Unsafe deployment archive")
            if item.name not in ("compose.yaml", "images.lock", "docs/07-wdrozenie/infrastruktura.md") and not item.name.startswith("infra/"):
                raise ValueError("Unexpected package file")
            names.add(item.name)
        bundle.extractall(destination, members=members, filter="data")


def validate_images(document, version):
    if set(document) != {"version", "commit", "images"} or document["version"] != version:
        raise ValueError("Invalid release lock")
    if not re.fullmatch(r"[a-f0-9]{40}", document["commit"]) or set(document["images"]) != SERVICES:
        raise ValueError("Incomplete release lock")
    for service, image in document["images"].items():
        prefix = f"ghcr.io/{REPOSITORY.lower()}-{service}@sha256:"
        if not re.fullmatch(re.escape(prefix) + r"[a-f0-9]{64}", image):
            raise ValueError("Invalid image identity")


def identity(version):
    return f"https://github.com/{REPOSITORY}/.github/workflows/release.yml@refs/tags/{version}"


def verify_provenance(output, document, version):
    statements = []
    try:
        decoded = json.loads(output)
        envelopes = decoded if isinstance(decoded, list) else [decoded]
    except json.JSONDecodeError:
        envelopes = [json.loads(line) for line in output.splitlines() if line.strip()]
    for envelope in envelopes:
        statements.append(json.loads(base64.b64decode(envelope["payload"], validate=True)))
    for statement in statements:
        predicate = statement.get("predicate", {})
        dependencies = predicate.get("buildDefinition", {}).get("resolvedDependencies", [])
        builder = predicate.get("runDetails", {}).get("builder", {}).get("id")
        if builder == identity(version) and any(dep.get("digest", {}).get("gitCommit") == document["commit"] for dep in dependencies):
            return
    raise ValueError("Provenance does not identify the locked commit and workflow")


def compose_args(release, config):
    return ["docker", "compose", "--project-name", "oliginvest", "--env-file", str(config / "instance.env"), "--env-file", str(release / "images.env"), "-f", str(release / "compose.yaml"), "-f", str(config / "runtime-compose.json")]


def notify_owner(path):
    # Hooks are instance configuration, never downloaded from release assets.
    if path.is_file() and not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0:
        subprocess.run([str(path)], check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def healthy(compose, execute=run):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            execute(compose + ["exec", "-T", "api", "node", "-e", "fetch('http://localhost:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"])
            execute(compose + ["exec", "-T", "web", "node", "-e", "fetch('http://localhost:3000').then(async r=>process.exit(r.ok&&(await r.text()).includes('<html')?0:1)).catch(()=>process.exit(1))"])
            return
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError("Health gate timed out")


def activate(candidate, previous, execute=run, gate=healthy):
    # Backup uses the current database binary/config before changing any image.
    database = previous or candidate
    if previous is None:
        step("initialize-data", execute, candidate + ["up", "-d", "--wait", "postgres", "valkey-queue", "valkey-cache"])
        step("stanza-create", execute, candidate + ["exec", "-T", "postgres", "oliginvest-pgbackrest", "stanza-create"])
    step("backup", execute, database + ["exec", "-T", "postgres", "oliginvest-pgbackrest", "--type=" + ("incr" if previous else "full"), "backup"])
    step("backup-check", execute, database + ["exec", "-T", "postgres", "oliginvest-pgbackrest", "check"])
    step("migrate", execute, candidate + ["run", "--rm", "--no-deps", "migrate"])
    try:
        for service in ACTIVE_SERVICES:
            step("activate-" + service, execute, candidate + ["up", "-d", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "120", service])
        step("health", gate, candidate, execute)
    except StepError as error:
        try:
            if previous:
                for service in ACTIVE_SERVICES:
                    step("rollback-" + service, execute, previous + ["up", "-d", "--force-recreate", "--no-deps", "--wait", "--wait-timeout", "120", service])
                step("rollback-health", gate, previous, execute)
            else:
                step("stop-first-deployment", execute, candidate + ["stop", "api", "jobs", "analytics", "web", "caddy"])
        except StepError as rollback:
            error.rollback_step = rollback.step
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("version")
    parser.add_argument("--retry-staged", action="store_true")
    parser.add_argument("--root", type=Path, default=Path("/opt/oliginvest"))
    parser.add_argument("--config", type=Path, default=Path("/etc/oliginvest"))
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", args.version):
        raise ValueError("Root and explicit SemVer required")
    if any(not path.is_absolute() or len(path.parts) < 3 or any(parent.is_symlink() for parent in [path, *path.parents]) for path in [args.root, args.config]):
        raise ValueError("Absolute non-symlink roots required")
    args.root.mkdir(mode=0o755, parents=True, exist_ok=True)
    args.config.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = os.open(args.config / ".operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    current = args.root / "current"
    previous = current.resolve() if current.is_symlink() else None
    if previous and previous.parent != args.root / "releases":
        raise ValueError("Unexpected current release")
    releases = args.root / "releases"
    releases.mkdir(mode=0o755, exist_ok=True)
    candidate = releases / args.version
    step("prepare-candidate", prepare_candidate, args.root, candidate, previous, args.retry_staged)
    with tempfile.TemporaryDirectory(prefix="download-", dir=args.root) as temporary:
        download = Path(temporary)
        step("download", download_assets, download, args.version)
        verification = ["--certificate-identity", identity(args.version), "--certificate-oidc-issuer", ISSUER]
        step("verify-package", run, ["cosign", "verify-blob", *verification, "--bundle", str(download / "oliginvest.sigstore.json"), str(download / "oliginvest.tar.gz")])
        staged = download / "verified"
        step("stage-package", staged.mkdir)
        step("unpack", unpack, download / "oliginvest.tar.gz", staged)
        document = step("read-lock", lambda: json.loads((staged / "images.lock").read_text()))
        step("validate-images", validate_images, document, args.version)
        for image in document["images"].values():
            step("verify-image", run, ["cosign", "verify", *verification, image])
            provenance = step("verify-attestation", run, ["cosign", "verify-attestation", *verification, "--type", "slsaprovenance1", image])
            step("verify-provenance", verify_provenance, provenance, document, args.version)
        step("stage-release", staged.rename, candidate)
    # Only verified code and images are used below this point.
    lines = [f"{name.replace('-', '_').upper()}_IMAGE={image}" for name, image in document["images"].items()]
    step("write-images", (candidate / "images.env").write_text, "\n".join(lines) + "\n")
    step("provision-secrets", provision, candidate, args.config)
    compose = compose_args(candidate, args.config)
    old_compose = compose_args(previous, args.config) if previous else None
    step("pull-images", run, compose + ["--profile", "operations", "pull"])
    activate(compose, old_compose)
    # SQL is fixed; no shell interpolation or user data enters the statement.
    step("audit", run, compose + ["exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "oliginvest", "-c", "INSERT INTO platform.audit_log(actor_ref,actor_type,action,outcome) VALUES ('deployment','system','system.deploy','success')"])
    pending = args.root / ".current-pending"
    step("prepare-current", pending.symlink_to, candidate)
    step("publish-current", os.replace, pending, current)
    step("log-success", run, ["logger", "--tag", "oliginvest", f"system.deploy success {args.version}"])
    try:
        notify_owner(args.config / "deploy-succeeded")
    except (OSError, subprocess.SubprocessError):
        # Monitoring failure must not misreport a completed healthy deployment.
        print("Deployment is healthy, but its monitoring hook failed.")
    print(f"Deployment healthy: {args.version}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log_failure(error)
        # Owner installs a local alert hook (mail via existing SMTP) outside the package.
        alert = Path("/etc/oliginvest/deploy-failed")
        try:
            notify_owner(alert)
        except (OSError, subprocess.SubprocessError):
            pass
        raise SystemExit("Deployment failed; inspect journald, current release pointer and service health.")
