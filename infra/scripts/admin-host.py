"""Owner-installed CLI wrapper and audited Caddy maintenance switch."""
import argparse
import fcntl
import importlib.util
import os
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location("host_operations", Path(__file__).with_name("host-operations.py"))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

# Fixed shell programs: owner input is only ever passed as separate argv entries.
ENABLE = 'printf \'respond "Przerwa techniczna. Sprobuj ponownie pozniej." 503\\n\' > /config/maintenance.caddy'
DISABLE = 'rm -f /config/maintenance.caddy'
RELOAD = 'caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --address "${CADDY_ADMIN_URL:-localhost:2019}"'


def maintenance(commands, action, reason, execute=host.run):
    if action not in ("on", "off") or not 5 <= len(reason) <= 500:
        raise ValueError("Invalid maintenance arguments")
    cli = commands + ["exec", "-T", "api", "node", "dist/admin-cli.js", "maintenance-audit", action, "--reason", reason]
    caddy = commands + ["exec", "-T", "caddy", "sh", "-c"]
    execute(cli + ["--outcome", "started"])
    previous = execute(caddy + ['if test -f /config/maintenance.caddy; then printf on; else printf off; fi']).strip()
    if previous not in ("on", "off"):
        raise RuntimeError("Invalid maintenance state")
    try:
        execute(caddy + [ENABLE if action == "on" else DISABLE])
        execute(caddy + [RELOAD])
    except Exception:
        try:
            execute(caddy + [ENABLE if previous == "on" else DISABLE])
            execute(caddy + [RELOAD])
        finally:
            execute(cli + ["--outcome", "error"])
        raise
    execute(cli + ["--outcome", "success"])


def main(arguments):
    if os.geteuid() != 0:
        raise ValueError("Root required")
    commands = host.compose()
    if arguments[:1] == ["maintenance"]:
        parser = argparse.ArgumentParser()
        parser.add_argument("action", choices=("on", "off"))
        parser.add_argument("--reason", required=True)
        args = parser.parse_args(arguments[1:])
        # Same lock as deployment/host operations; never overwrite an operator's release switch.
        descriptor = os.open(host.CONFIG / ".operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            maintenance(commands, args.action, args.reason)
    else:
        tty = [] if sys.stdin.isatty() and sys.stdout.isatty() else ["-T"]
        result = subprocess.run(commands + ["exec", *tty, "api", "node", "dist/admin-cli.js", *arguments], check=False)
        return result.returncode
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Never echo argv, credentials, SQL or container output.
        sys.stderr.write("Operacja administracyjna nie powiodla sie; sprawdz audyt i stan uslug.\n")
        sys.exit(1)
