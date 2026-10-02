"""Owner-installed host timers. Fixed sources; credentials and output stay on host."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.parse
import urllib.request

CONFIG = Path("/etc/oliginvest")
ROOT = Path("/opt/oliginvest")
BACKUP = Path("/srv/backup")
CADDY = Path("/srv/oliginvest/caddy-data")
ACTIONS = ("init-offsite", "backup-full", "backup-diff", "backup-offsite", "verify", "vm-health")


def run(command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, timeout=7200, **kwargs)
    if result.returncode:
        raise RuntimeError("Host operation command failed")
    return result.stdout


def secret(name):
    path = CONFIG / "secrets" / name
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise ValueError("Invalid host secret permissions")
    value = path.read_text().strip()
    if not value or len(value) > 4096:
        raise ValueError("Invalid host secret")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def heartbeat(name, ok):
    url = secret("KUMA_" + name.upper().replace("-", "_") + "_URL")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or parts.username or parts.fragment or not parts.path.startswith("/api/push/"):
        raise ValueError("Invalid monitor URL")
    # The owner supplies the tunnel endpoint, never an application/user URL.
    url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode({"status": "up" if ok else "down", "msg": "OK" if ok else "FAIL"})))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=15) as response:
        if not json.loads(response.read(4096)).get("ok"):
            raise RuntimeError("Monitor rejected heartbeat")


def compose():
    current = ROOT / "current"
    release = current.resolve(strict=True)
    if not current.is_symlink() or release.parent != ROOT / "releases":
        raise ValueError("No active release")
    spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.compose_args(release, CONFIG)


def restic(arguments, execute=run):
    environment = {"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8",
                   "RESTIC_REPOSITORY": secret("RESTIC_REPOSITORY"),
                   "RESTIC_REST_USERNAME": secret("RESTIC_REST_USERNAME"),
                   "RESTIC_REST_PASSWORD": secret("RESTIC_REST_PASSWORD"),
                   "RESTIC_PASSWORD_FILE": str(CONFIG / "secrets/RESTIC_PASSWORD"),
                   "RESTIC_CACHE_DIR": "/var/cache/oliginvest-restic"}
    secret("RESTIC_PASSWORD")  # Validate file, but pass only its path to restic.
    return execute(["restic", *arguments], env=environment)


def validate_storage(execute=run):
    for volume, source in (("backup-data", BACKUP / "pgbackrest"), ("caddy-data", CADDY)):
        record = json.loads(execute(["docker", "volume", "inspect", "oliginvest_" + volume]))[0]
        options = record.get("Options") or {}
        if record.get("Driver") != "local" or options.get("type") != "none" or options.get("o") != "bind" or options.get("device") != str(source):
            raise ValueError("Storage volume is not bound to the expected host source")


def vm_healthy(containers, tracking, memory, disk_usages):
    expected = {"postgres", "valkey-queue", "valkey-cache", "caddy", "api", "web", "jobs", "analytics"}
    healthy = {c["Service"] for c in containers if c.get("State") == "running" and c.get("Health") == "healthy"}
    if not expected <= healthy or any(used / total > 0.8 for used, total in disk_usages):
        return False
    values = dict(re.findall(r"^(MemTotal|MemAvailable):\s+(\d+) kB", memory, re.M))
    offset = re.search(r"System time\s*:\s*([0-9.]+) seconds", tracking)
    return (int(values["MemAvailable"]) / int(values["MemTotal"]) >= 0.1
            and offset is not None and abs(float(offset[1])) <= 2
            and re.search(r"Leap status\s*:\s*Normal", tracking) is not None)


def perform(action, commands, execute=run, rest=restic):
    execute(["mountpoint", "--quiet", str(BACKUP)])
    pg = commands + ["exec", "-T", "postgres", "oliginvest-pgbackrest"]
    if action == "init-offsite":
        rest(["init"])
    elif action in ("backup-full", "backup-diff"):
        execute(pg + ["--type=" + action.removeprefix("backup-"), "backup"])
        execute(pg + ["check"])
    elif action == "backup-offsite":
        sources = [BACKUP / "pgbackrest", CADDY, BACKUP / "erasure-log.jsonl"]
        if any(not p.exists() or p.is_symlink() for p in sources):
            raise ValueError("Missing backup source")
        rest(["backup", "--one-file-system", "--tag", "oliginvest", *map(str, sources)])
    elif action == "verify":
        execute(pg + ["verify"])
        rest(["check", "--read-data-subset=5%"])
    elif action == "vm-health":
        raw = execute(commands + ["ps", "--all", "--format", "json"]).strip()
        containers = json.loads(raw) if raw.startswith("[") else [json.loads(line) for line in raw.splitlines()]
        tracking = execute(["chronyc", "-n", "tracking"], env={**os.environ, "LC_ALL": "C"})
        disks = [shutil.disk_usage(p) for p in (Path("/"), BACKUP)]
        if not vm_healthy(containers, tracking, Path("/proc/meminfo").read_text(), [(d.used, d.total) for d in disks]):
            raise RuntimeError("Host unhealthy")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=ACTIONS)
    action = parser.parse_args().action
    if os.geteuid() != 0:
        raise SystemExit("Root required")
    monitor = "backup-local" if action in ("backup-full", "backup-diff") else action
    # Verification uses its own monitor, never refreshes a backup-success monitor.
    try:
        descriptor = os.open(CONFIG / ".operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            if action != "vm-health":
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            commands = compose()
            validate_storage()
            perform(action, commands)
        if action != "init-offsite":
            heartbeat(monitor, True)
    except BlockingIOError:
        run(["logger", "--tag", "oliginvest", "host.operation busy action=" + action])
        # No false heartbeat: prolonged contention is detected by the stale monitor.
        return
    except Exception:
        try:
            if action != "init-offsite":
                heartbeat(monitor, False)
        except Exception:
            pass
        try:
            run(["logger", "--tag", "oliginvest", "--priority", "user.err", "host.operation failed action=" + action])
        finally:
            raise SystemExit("Host operation failed; inspect local service state") from None
    print("Host operation completed: " + action)


if __name__ == "__main__":
    main()
