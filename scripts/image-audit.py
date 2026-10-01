"""Pinned image SBOM / OSV scan; fail closed on unknown severities."""
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tomllib
import datetime as dt

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("dependency_audit", ROOT / "scripts/deps-audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def assess(document, ignored):
    sources = document.get("results")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Empty image scan")
    count = 0
    blocked = []
    for source in sources:
        for package in source.get("packages", []):
            count += 1
            for vulnerability in package.get("vulnerabilities", []):
                groups = [g for g in package.get("groups", []) if vulnerability["id"] in g["ids"]]
                if len(groups) != 1:
                    raise ValueError("Missing image severity")
                score = float(groups[0]["max_severity"])
                if not math.isfinite(score) or not 0 <= score <= 10:
                    raise ValueError("Invalid image severity")
                aliases = {vulnerability["id"], *vulnerability.get("aliases", [])}
                if score >= 7 and not aliases.intersection(ignored):
                    blocked.append(vulnerability["id"])
    if count == 0:
        raise ValueError("No image packages")
    return sorted(set(blocked))


def main():
    destination = ROOT / "reports/images"
    destination.mkdir(parents=True, exist_ok=True)
    audit.TOOLS.mkdir(parents=True, exist_ok=True)
    osv, syft = audit.install("osv"), audit.install("syft")
    ignored = audit.exceptions(tomllib.loads((ROOT / "osv-scanner.toml").read_text()), dt.date.today())
    failures = []
    for service in sys.argv[1:]:
        if service not in ("web", "api", "jobs", "analytics", "postgres", "migrate", "caddy", "valkey-queue", "valkey-cache"):
            raise ValueError("Unknown image")
        image = f"oliginvest-local/{service}:m0-2"
        sbom = destination / f"{service}.cdx.json"
        subprocess.run([syft, f"docker:{image}", "-o", f"cyclonedx-json={sbom}", "--quiet"], check=True)
        report = destination / f"{service}.osv.json"
        with (destination / f"{service}.log").open("w") as log:
            result = subprocess.run([osv, "scan", "image", "--all-packages", "--all-vulns", "--format=json", f"--output-file={report}", image], stdout=log, stderr=log)
        if result.returncode not in (0, 1):
            raise ValueError("Image scanner failed")
        blocked = assess(json.loads(report.read_text()), ignored)
        failures.extend(f"{service}: {item}" for item in blocked)
        print(f"{service}: {'FAIL' if blocked else 'PASS'}")
    (destination / "summary.md").write_text("\n".join(failures) if failures else "Image vulnerability policy PASS\n")
    if failures:
        raise ValueError("Image high/critical findings; see reports/images/summary.md")


if __name__ == "__main__":
    main()
