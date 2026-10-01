"""Pinned image SBOM / OSV scan; fail closed on unknown severities."""
import importlib.util
import json
import math
import os
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
                package_id = package["package"]
                affected_here = [a for a in vulnerability.get("affected", []) if a.get("package", {}).get("ecosystem") == package_id["ecosystem"] and a.get("package", {}).get("name") == package_id["name"]]
                if not affected_here:
                    raise ValueError("Missing matching affected package")
                fixed = any("fixed" in event for affected in affected_here for interval in affected.get("ranges", []) for event in interval.get("events", []))
                # Availability of a fix is an explicit condition of CI/CD §5.
                # Unknown severities without a fix remain visible in the report.
                if not fixed:
                    continue
                # Debian explicitly classifies some historical entries as
                # unimportant without a CVSS score. This is a known distro
                # classification, not an unknown score or a local exception.
                if groups[0]["max_severity"] == "" and affected_here and all(a.get("ecosystem_specific", {}).get("urgency") == "unimportant" for a in affected_here):
                    continue
                score = float(groups[0]["max_severity"])
                if not math.isfinite(score) or not 0 <= score <= 10:
                    raise ValueError("Invalid image severity")
                aliases = {vulnerability["id"], *vulnerability.get("aliases", [])}
                # CI/CD §5: image release gate = critical with an available fix.
                # The independent lockfile gate remains high/critical regardless of fix.
                if score >= 9 and fixed and not aliases.intersection(ignored):
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
    summaries = []
    for service in sys.argv[1:]:
        if service not in ("web", "api", "jobs", "analytics", "postgres", "migrate", "caddy", "valkey-queue", "valkey-cache"):
            raise ValueError("Unknown image")
        image = f"oliginvest-local/{service}:m0-2"
        sbom = destination / f"{service}.cdx.json"
        archive = Path(os.environ["IMAGE_ARCHIVE_DIRECTORY"]) / f"{service}.tar" if os.environ.get("IMAGE_ARCHIVE_DIRECTORY") else None
        subprocess.run([syft, f"docker-archive:{archive}" if archive else f"docker:{image}", "-o", f"cyclonedx-json={sbom}", "--quiet"], check=True)
        report = destination / f"{service}.osv.json"
        with (destination / f"{service}.log").open("w") as log:
            result = subprocess.run([osv, "scan", "image", "--all-packages", "--format=json", f"--output-file={report}", *(["--archive", str(archive)] if archive else [image])], stdout=log, stderr=log)
        if result.returncode not in (0, 1):
            raise ValueError("Image scanner failed")
        document = json.loads(report.read_text())
        try:
            blocked = assess(document, ignored)
        except ValueError as error:
            blocked = [f"Assessment failed: {error}"]
        failures.extend(f"{service}: {item}" for item in blocked)
        findings = sorted({v["id"] for source in document["results"] for package in source.get("packages", []) for v in package.get("vulnerabilities", [])})
        summaries.append(f"{service}: {'FAIL' if blocked else 'PASS'}; reported findings: {', '.join(findings) or 'none'}")
        print(f"{service}: {'FAIL' if blocked else 'PASS'}", flush=True)
    (destination / "summary.md").write_text("Image gate: critical with available fix (CI/CD §5). Full severities and affected packages: *.osv.json.\n\n" + "\n".join(summaries) + "\n", encoding="utf-8")
    if failures:
        raise ValueError("Fixable critical image findings; see reports/images/summary.md")


if __name__ == "__main__":
    main()
