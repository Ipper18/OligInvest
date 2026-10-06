"""Host-only secret provisioning. The INF table is the sole recipient catalog."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile

INF = Path(__file__).resolve().parents[2] / "docs/07-wdrozenie/infrastruktura.md"


def matrix(text=None):
    text = INF.read_text(encoding="utf-8") if text is None else text
    body = text.split("<!-- runtime-secret-matrix:start -->")[1].split("<!-- runtime-secret-matrix:end -->")[0]
    result = {}
    for line in body.strip().splitlines()[2:]:
        fields = [x.strip() for x in line.strip().strip("|").split("|")]
        if len(fields) != 5:
            raise ValueError("Invalid matrix row")
        service, uid, gid, required, optional = fields
        if not re.fullmatch(r"[a-z][a-z-]*", service) or service in result:
            raise ValueError("Invalid service")
        if not uid.isdecimal() or not gid.isdecimal() or min(int(uid), int(gid)) < 1:
            raise ValueError("Non-root numeric IDs required")
        def names(value):
            values = [] if value == "—" else value.split(", ")
            if any(not re.fullmatch(r"[A-Z][A-Z0-9_]*", item) for item in values) or len(set(values)) != len(values):
                raise ValueError("Invalid secret names")
            return values
        result[service] = {"uid": int(uid), "gid": int(gid), "required": names(required), "optional": names(optional)}
        if set(result[service]["required"]) & set(result[service]["optional"]):
            raise ValueError("Duplicate secret")
    if not result:
        raise ValueError("Empty matrix")
    return result


def directory(path):
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError("Unsafe directory")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(path, 0, 0)
    path.chmod(0o700)


def atomic(path, content, uid=0, gid=0, mode=0o600):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("Unsafe target")
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fchown(stream.fileno(), uid, gid)
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(name, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_secret(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o777 != 0o600:
            raise ValueError("Unsafe original permissions")
        value = stream.read(65537).removesuffix(b"\n").removesuffix(b"\r")
        if not value or len(value) > 65536 or any(c < 32 or c == 127 for c in value):
            raise ValueError("Invalid secret")
        value.decode("utf-8")
        return value


def acl(values, cache=False):
    lines = ["user default off"]
    for service in (["api", "jobs"] if cache else ["api", "jobs", "analytics"]):
        key = f"VALKEY_{'CACHE' if cache else 'QUEUE'}_{service.upper()}_PASSWORD"
        digest = hashlib.sha256(values[key]).hexdigest()
        if cache:
            keys = "~cache:* ~u:* ~inflight:* ~sse:* ~flags:* &sse:* &flags:* &flags.changed"
            commands = "+ping +get +set +del +expire +pexpire +ttl +pttl +eval +evalsha +script|load +publish +subscribe +unsubscribe +client|setname +client|setinfo"
        else:
            queues = ["analytics", "analytics-results"] if service == "analytics" else ["ingest", "import", "recompute", "alerts", "notify", "analytics", "analytics-results", "events"]
            keys = " ".join(f"~bull:{queue}:*" for queue in queues) + f" ~health:{service}:*"
            if service == "api":
                keys += " ~auth:*"
            if service == "jobs":
                keys += " ~quota:* ~breaker:*"
            commands = "+@read +@write +@scripting +@transaction +ping +info +client|setname +client|setinfo -flushall -flushdb -config -debug -module -acl -keys -scan -randomkey -migrate -restore -sort -sort_ro"
        lines.append(f"user {service} on #{digest} {keys} {commands}")
    return ("\n".join(lines) + "\n").encode()


def provision(root):
    if os.geteuid() != 0 or not root.is_absolute() or root.is_symlink():
        raise ValueError("Root and absolute non-symlink directory required")
    directory(root)
    original = root / "secrets"
    runtime = root / "runtime-secrets"
    directory(original)
    directory(runtime)
    catalog = matrix()
    derived = {"VALKEY_QUEUE_ACL", "VALKEY_CACHE_ACL"}
    required = {key for row in catalog.values() for key in row["required"]} - derived
    optional = {key for row in catalog.values() for key in row["optional"]}
    values = {}
    for key in sorted(required | optional):
        path = original / key
        if not path.exists() and not path.is_symlink():
            if key in optional:
                continue
            value = secrets.token_hex(32)
            if key == "BETTER_AUTH_SECRETS":
                value = "1:" + value
            atomic(path, value.encode())
        values[key] = read_secret(path)
    values["VALKEY_QUEUE_ACL"] = acl(values)
    values["VALKEY_CACHE_ACL"] = acl(values, cache=True)
    for key in derived:
        atomic(original / key, values[key])
    # Complete all validation before changing any consumer file.
    for service, row in catalog.items():
        directory(runtime / service)
        for path in (runtime / service).iterdir():
            if path.is_symlink() or not path.is_file():
                raise ValueError("Unsafe runtime file")
    for service, row in catalog.items():
        expected = set(row["required"]) | (set(row["optional"]) & values.keys())
        for key in sorted(expected):
            atomic(runtime / service / key, values[key], row["uid"], row["gid"], 0o400)
        for path in (runtime / service).iterdir():
            if path.name not in expected:
                path.unlink()
    overlay = {"services": {}, "secrets": {}}
    for service, row in catalog.items():
        selected = sorted(set(row["required"]) | (set(row["optional"]) & values.keys()))
        overlay["services"][service] = {"secrets": [], "environment": {}}
        for key in selected:
            identity = service + "_" + key
            overlay["secrets"][identity] = {"file": str(runtime / service / key)}
            overlay["services"][service]["secrets"].append({"source": identity, "target": key})
            overlay["services"][service]["environment"][key + "_FILE"] = "/run/secrets/" + key
    atomic(root / "runtime-compose.json", (json.dumps(overlay, indent=2) + "\n").encode())
    # Recreate consumers only after this function succeeds, under the same host lock.
    print("Secret copies synchronized; recreate all affected consumers before use.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/etc/oliginvest"))
    args = parser.parse_args()
    if os.geteuid() != 0 or not args.root.is_absolute() or len(args.root.parts) < 3 or any(path.is_symlink() for path in [args.root, *args.root.parents]):
        raise ValueError("Root and an absolute private configuration directory required")
    directory(args.root)
    lock = os.open(args.root / ".operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        provision(args.root)
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Secret provisioning failed; consumers must not be recreated.", file=sys.stderr)
        sys.exit(1)
