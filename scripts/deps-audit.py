"""BL-017: pinned scanners, complete lockfile SBOM, fail-closed policy."""

import datetime as dt
import hashlib
import io
import json
import math
import re
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
TOOLS = ROOT / ".git/tools/ci-deps"
ALLOWED = {
    "MIT",
    "MIT-0",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "CC0-1.0",
    "Unlicense",
    "MPL-2.0",
    "PostgreSQL",
}
# Owner decision 2026-09-30; package-specific, not a global extension.
REVIEWED = {
    ("argparse", "Python-2.0"),
    ("typing-extensions", "PSF-2.0"),
    ("caniuse-lite", "CC-BY-4.0"),
}
# License declarations missing/ambiguous in upstream PyPI metadata; see STACK §7.
METADATA = {
    ("bullmq", "3.2.2"): "MIT",
    ("colorama", "0.4.6"): "BSD-3-Clause",
    ("mypy-extensions", "1.1.0"): "MIT",
    ("pathspec", "1.1.1"): "MPL-2.0",
    ("python-dateutil", "2.9.0.post0"): "Apache-2.0 OR BSD-3-Clause",
}


def exceptions(config, today):
    if set(config) - {"IgnoredVulns"}:
        raise ValueError(
            "Unsupported OSV config section (only IgnoredVulns is allowed)"
        )
    result = {}
    for entry in config.get("IgnoredVulns", []):
        if set(entry) != {"id", "ignoreUntil", "reason"}:
            raise ValueError("Exception must contain id, ignoreUntil and reason only")
        identity, reason, until = entry["id"], entry["reason"], entry["ignoreUntil"]
        approval = re.search(r"approved=(\d{4}-\d{2}-\d{2})", reason)
        if not approval or not re.search(r"\bR-\d+\b", reason) or len(reason) < 40:
            raise ValueError(
                "Exception needs approval date, risk reference and rationale"
            )
        start = dt.date.fromisoformat(approval[1])
        if (
            not isinstance(until, dt.date)
            or not start <= today < until
            or not 0 < (until - start).days <= 90
        ):
            raise ValueError("Exception expired, future-dated or longer than 90 days")
        if not isinstance(identity, str) or not identity or identity in result:
            raise ValueError("Duplicate/invalid exception identifier")
        result[identity] = entry
    return result


def findings(document, ignored):
    if not isinstance(document.get("results"), list) or not document["results"]:
        raise ValueError("OSV report has no scan results")
    rows, packages, sources = [], set(), set()
    for source in document["results"]:
        sources.add(Path(source["source"]["path"]).name)
        if not isinstance(source.get("packages"), list) or not source["packages"]:
            raise ValueError("Empty/malformed OSV package inventory")
        for item in source["packages"]:
            package = item["package"]
            packages.add((package["ecosystem"], package["name"], package["version"]))
            for vuln in item.get("vulnerabilities", []):
                groups = [g for g in item.get("groups", []) if vuln["id"] in g["ids"]]
                if len(groups) != 1:
                    raise ValueError("Missing/ambiguous OSV severity group")
                score = float(groups[0]["max_severity"])
                if not math.isfinite(score) or not 0 <= score <= 10:
                    raise ValueError("Invalid OSV CVSS score")
                aliases = {
                    vuln["id"],
                    *vuln.get("aliases", []),
                    *groups[0].get("aliases", []),
                }
                exemption = next((key for key in ignored if key in aliases), None)
                rows.append(
                    (package["name"], package["version"], vuln["id"], score, exemption)
                )
    if sources != {"pnpm-lock.yaml", "uv.lock"}:
        raise ValueError("Both and only npm/Python lockfiles must be scanned")
    return rows, packages


def license_allowed(expression, name):
    tokens = re.findall(r"[A-Za-z0-9.+-]+|[()]", expression)
    if "".join(tokens) != re.sub(r"\s", "", expression):
        raise ValueError("Malformed SPDX expression")
    index = 0

    def atom():
        nonlocal index
        if index >= len(tokens):
            raise ValueError("Incomplete SPDX expression")
        token = tokens[index]
        index += 1
        if token == "(":
            value = either()
            if index >= len(tokens) or tokens[index] != ")":
                raise ValueError("Unbalanced SPDX expression")
            index += 1
            return value
        if token in {"AND", "OR", ")", "WITH"}:
            raise ValueError("Unexpected SPDX operator")
        lgpl = token in {"LGPL-3.0-only", "LGPL-3.0-or-later"} and (
            name in {"psycopg", "psycopg-binary"} or name.startswith("@img/sharp-")
        )
        return token in ALLOWED or (name, token) in REVIEWED or lgpl

    def both():
        nonlocal index
        value = atom()
        while index < len(tokens) and tokens[index] == "AND":
            index += 1
            right = atom()
            value = value and right
        return value

    def either():
        nonlocal index
        value = both()
        while index < len(tokens) and tokens[index] == "OR":
            index += 1
            right = both()
            value = value or right
        return value

    value = either()
    if index != len(tokens):
        raise ValueError("Unsupported SPDX expression")
    return value


def licenses(sbom, expected):
    if sbom.get("bomFormat") != "CycloneDX" or not sbom.get("components"):
        raise ValueError("Missing/malformed CycloneDX SBOM")
    seen, rejected, normalized = set(), [], []
    for component in sbom["components"]:
        name, version = component["name"], component["version"]
        purl = component["purl"]
        ecosystem = (
            "npm"
            if purl.startswith("pkg:npm/")
            else "PyPI"
            if purl.startswith("pkg:pypi/")
            else None
        )
        if ecosystem is None:
            raise ValueError("Unexpected package ecosystem in SBOM")
        seen.add((ecosystem, name, version))
        if (name, version) == ("oliginvest-analytics", "0.0.0"):
            continue  # This repository's private workspace is intentionally unlicensed (ADR-013).
        declarations = component.get("licenses", [])
        expressions = [
            entry.get("expression")
            or entry.get("license", {}).get("id")
            or entry.get("license", {}).get("name", "")
            for entry in declarations
        ]
        expressions = [
            {"MIT License": "MIT", "Apache 2.0": "Apache-2.0"}.get(value, value)
            for value in expressions
        ]
        if ecosystem == "PyPI" and (name, version) in METADATA:
            expressions = [METADATA[(name, version)]]
            normalized.append(f"{name}@{version}: {expressions[0]}")
        if not expressions or not all(
            license_allowed(value, name) for value in expressions
        ):
            rejected.append(f"{name}@{version}: {', '.join(expressions) or 'UNKNOWN'}")
    if expected - seen:
        raise ValueError(f"SBOM misses locked packages: {sorted(expected - seen)}")
    return rejected, normalized


def install(tool):
    windows = sys.platform == "win32"
    if not windows and sys.platform != "linux":
        raise ValueError("Audit installer supports Windows/Linux amd64")
    pins = {
        ("osv", False): (
            "google/osv-scanner",
            "v2.6.0",
            "osv-scanner_linux_amd64",
            "ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108",
        ),
        ("osv", True): (
            "google/osv-scanner",
            "v2.6.0",
            "osv-scanner_windows_amd64.exe",
            "e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6",
        ),
        ("syft", False): (
            "anchore/syft",
            "v1.52.0",
            "syft_1.52.0_linux_amd64.tar.gz",
            "caeedb81fb0491615f1ebd1761e4145d41ee86dd2cc7bf80669f9f5ad9d6133d",
        ),
        ("syft", True): (
            "anchore/syft",
            "v1.52.0",
            "syft_1.52.0_windows_amd64.zip",
            "de787a374cf961c56fd7b206b2e183295abba32d0af3cb44d9aef2357ca9eda2",
        ),
    }
    repo, tag, asset, digest = pins[tool, windows]
    archive = TOOLS / asset
    if not archive.exists():
        with urllib.request.urlopen(
            f"https://github.com/{repo}/releases/download/{tag}/{asset}", timeout=60
        ) as response:
            archive.write_bytes(response.read())
    content = archive.read_bytes()
    if hashlib.sha256(content).hexdigest() != digest:
        raise ValueError(f"Checksum mismatch: {asset}")
    binary = TOOLS / (tool + (".exe" if windows else ""))
    if tool == "syft":
        if windows:
            with zipfile.ZipFile(io.BytesIO(content)) as bundle:
                content = bundle.read("syft.exe")
        else:
            with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as bundle:
                content = bundle.extractfile("syft").read()
    binary.write_bytes(content)
    binary.chmod(0o755)
    return str(binary)


def command(args, log, allowed=(0,)):
    with (REPORTS / log).open("w", encoding="utf8") as output:
        result = subprocess.run(
            args,
            cwd=ROOT,
            stdout=output,
            stderr=subprocess.STDOUT,
            timeout=600,
            check=False,
        )
    if result.returncode not in allowed:
        raise ValueError(f"Scanner failed ({result.returncode}); see {log}")
    return result.returncode


def main():
    REPORTS.mkdir(exist_ok=True)
    TOOLS.mkdir(parents=True, exist_ok=True)
    summary = [
        "# Audyt zależności",
        "",
        "Próg: CVSS ≥ 7,0; błędy narzędzi, brak oceny i nieznane licencje blokują.",
        "",
    ]
    failed = True
    try:
        ignored = exceptions(
            tomllib.loads((ROOT / "osv-scanner.toml").read_text()),
            dt.datetime.now(dt.timezone.utc).date(),
        )
        osv = install("osv")
        syft = install("syft")
        empty = TOOLS / "no-exceptions.toml"
        empty.write_text("# Full findings, reporting only\n")
        for label, config in [
            ("full", empty),
            ("configured", ROOT / "osv-scanner.toml"),
        ]:
            target = REPORTS / f"deps-audit-{label}.json"
            target.unlink(missing_ok=True)
            status = command(
                [
                    osv,
                    "scan",
                    "source",
                    "--lockfile=pnpm-lock.yaml",
                    "--lockfile=apps/analytics/uv.lock",
                    f"--config={config}",
                    "--all-packages",
                    "--all-vulns",
                    "--format=json",
                    f"--output-file={target}",
                ],
                f"deps-audit-{label}.log",
                (0, 1),
            )
            data = json.loads(target.read_text())
            parsed, packages = findings(data, ignored)
            if status == 1 and not parsed:
                raise ValueError("OSV returned failure without vulnerability findings")
            if label == "full":
                rows, expected = parsed, packages
        summary += [
            "## Podatności (także moderate/low i wyjątki)",
            "",
            "| Pakiet | ID | CVSS | Wynik |",
            "|---|---|---|---|",
        ]
        for name, version, identity, score, exemption in rows:
            state = (
                f"WYJĄTEK {exemption}"
                if exemption
                else "BLOCK"
                if score >= 7
                else "przegląd Renovate"
            )
            summary.append(f"| {name}@{version} | {identity} | {score} | {state} |")
        summary += ["", "## Ważne wyjątki z osv-scanner.toml", ""]
        for identity, entry in ignored.items():
            summary.append(
                f"- {identity}, do {entry['ignoreUntil']}: {entry['reason']}"
            )
        # Scan just both lockfiles, including optional platform packages. Registry enrichment
        # provides licenses; do not traverse installed trees, local secrets or nested checkouts.
        source = TOOLS / "sbom-source"
        source.mkdir(exist_ok=True)
        for origin in [ROOT / "pnpm-lock.yaml", ROOT / "apps/analytics/uv.lock"]:
            (source / origin.name).write_bytes(origin.read_bytes())
        sbom = REPORTS / "deps-audit.cdx.json"
        sbom.unlink(missing_ok=True)
        command(
            [
                syft,
                "scan",
                f"dir:{source}",
                "--source-name=oliginvest-lockfiles",
                "--override-default-catalogers=javascript-lock-cataloger,python-package-cataloger",
                "--enrich=javascript,python",
                f"--output=cyclonedx-json={sbom}",
            ],
            "deps-audit-syft.log",
        )
        rejected, normalized = licenses(json.loads(sbom.read_text()), expected)
        summary += [
            "",
            f"## Licencje i pokrycie SBOM: {len(expected)} pakietów z lockfile",
            "",
        ]
        summary += [f"- BLOCK: {value}" for value in rejected]
        summary += [
            f"- Uzupełnienie metadanych ze źródła: {value}" for value in normalized
        ]
        failed = bool(rejected) or any(
            score >= 7 and not exemption for _, _, _, score, exemption in rows
        )
        summary += ["", "Wynik: BLOCK" if failed else "Wynik: PASS"]
    except Exception as error:  # noqa: BLE001 - CLI boundary must publish failure diagnostics.
        summary += ["", f"BLOCK: {type(error).__name__}: {error}"]
    finally:
        (REPORTS / "deps-audit.md").write_text(
            "\n".join(summary) + "\n", encoding="utf8"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
