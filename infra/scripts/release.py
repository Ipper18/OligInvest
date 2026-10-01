"""Tag-only publication; invoked exclusively by release.yml's release job."""
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    version = os.environ["GITHUB_REF_NAME"]
    repository = os.environ["GITHUB_REPOSITORY"]
    if os.environ["GITHUB_EVENT_NAME"] != "push" or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Owner-created SemVer tag required")
    run("git", "fetch", "origin", "main", "--no-tags")
    run("git", "merge-base", "--is-ancestor", "HEAD", "origin/main")
    sha = run("git", "rev-parse", "HEAD")
    checks = json.loads(run("gh", "api", f"repos/{repository}/commits/{sha}/check-runs?per_page=100"))["check_runs"]
    required = json.loads(Path(".github/rulesets/main.json").read_text())["rules"]
    names = next(rule["parameters"]["required_status_checks"] for rule in required if rule["type"] == "required_status_checks")
    for name in [x["context"] for x in names] + ["CodeQL"]:
        matches = sorted((c for c in checks if c["name"] == name), key=lambda c: c["id"], reverse=True)
        if not matches or matches[0]["conclusion"] != "success":
            raise ValueError(f"Green checks on tagged commit required: {name}")
    services = ["web", "api", "jobs", "analytics", "postgres", "migrate", "caddy", "valkey-queue", "valkey-cache"]
    images = {}
    for service in services:
        local = f"oliginvest-local/{service}:m0-2"
        remote = f"ghcr.io/{repository.lower()}-{service}:{version}"
        run("docker", "tag", local, remote)
        run("docker", "push", remote)
        digest = run("docker", "image", "inspect", remote, "--format", "{{index .RepoDigests 0}}")
        if not re.fullmatch(re.escape(remote.rsplit(":", 1)[0]) + r"@sha256:[a-f0-9]{64}", digest):
            raise ValueError("Unexpected published digest")
        images[service] = digest
        run("cosign", "sign", "--yes", digest)
        run("cosign", "attest", "--yes", "--type", "cyclonedx", "--predicate", f"reports/images/{service}.cdx.json", digest)
        predicate = Path("reports/images/provenance.json")
        predicate.write_text(json.dumps({"buildDefinition": {"buildType": "https://github.com/Attestations/GitHubActionsWorkflow@v1", "externalParameters": {"workflow": {"repository": f"https://github.com/{repository}", "path": ".github/workflows/release.yml", "ref": f"refs/tags/{version}"}}, "internalParameters": {}, "resolvedDependencies": [{"uri": f"git+https://github.com/{repository}", "digest": {"gitCommit": sha}}]}, "runDetails": {"builder": {"id": f"https://github.com/{repository}/.github/workflows/release.yml@refs/tags/{version}"}, "metadata": {"invocationId": os.environ["GITHUB_RUN_ID"]}}}))
        run("cosign", "attest", "--yes", "--type", "slsaprovenance1", "--predicate", str(predicate), digest)
    Path("images.lock").write_text(json.dumps({"version": version, "commit": sha, "images": images}, indent=2) + "\n")
    Path("release").mkdir(exist_ok=True)
    package = Path("release/oliginvest.tar.gz")
    with tarfile.open(package, "w:gz") as bundle:
        for path in [Path("compose.yaml"), Path("images.lock"), Path("docs/07-wdrozenie/infrastruktura.md"), *Path("infra").rglob("*")]:
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                bundle.add(path, arcname=path.as_posix(), recursive=False)
    run("cosign", "sign-blob", "--yes", "--bundle", "release/oliginvest.sigstore.json", str(package))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for service, image in images.items():
            output.write(f"{service.replace('-', '_')}_name={image.split('@')[0]}\n")
            output.write(f"{service.replace('-', '_')}_digest={image.split('@')[1]}\n")


if __name__ == "__main__":
    main()
