"""Download only the tarballs identified by successful build-job outputs."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import zipfile


def fetch(endpoint, destination):
    for attempt in range(6):
        with destination.open("wb") as output:
            result = subprocess.run([shutil.which("gh") or "gh", "api", endpoint], stdout=output, stderr=subprocess.PIPE)
        if result.returncode == 0:
            return
        # Newly finalized artifacts can briefly return 404.
        if b"HTTP 404" not in result.stderr or attempt == 5:
            raise SystemExit(result.stderr.decode(errors="replace"))
        time.sleep(5)


def download(receipt, name, expected, destination, scratch):
    match = re.fullmatch(r"([1-9][0-9]*):([a-f0-9]{64})", receipt)
    if not match:
        raise SystemExit(f"Missing or invalid upload receipt for {name}.")
    artifact_id, digest = match.groups()
    endpoint = f"repos/{os.environ['GITHUB_REPOSITORY']}/actions/artifacts/{artifact_id}"
    metadata_file = scratch / "artifact.json"
    fetch(endpoint, metadata_file)
    metadata = json.loads(metadata_file.read_bytes())
    if (str(metadata.get("workflow_run", {}).get("id")) != os.environ["GITHUB_RUN_ID"]
            or not re.fullmatch(re.escape(name) + r"-[1-9][0-9]*", metadata.get("name", ""))
            or metadata.get("expired") is not False):
        raise SystemExit(f"Artifact metadata does not match the release run for {name}.")
    archive = scratch / "artifact.zip"
    fetch(endpoint + "/zip", archive)
    hash_sum = hashlib.sha256()
    with archive.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hash_sum.update(chunk)
    if hash_sum.hexdigest() != digest:
        raise SystemExit(f"Artifact digest does not match the verified upload for {name}.")
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) != len(expected) or {entry.filename for entry in entries} != expected:
            raise SystemExit(f"Unexpected release tarballs in {name}.")
        for entry in entries:
            if not 0 < entry.file_size <= 512 * 1024 * 1024 or stat.S_ISLNK(entry.external_attr >> 16):
                raise SystemExit(f"Invalid tarball entry in {name}.")
            with bundle.open(entry) as source, (destination / entry.filename).open("xb") as output:
                shutil.copyfileobj(source, output)


def main():
    version = os.environ["VERSION"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", version):
        raise SystemExit("Invalid release version.")
    prerelease = "-" in version
    packages = ["socket"] if prerelease else ["socket", "socketsecurity-cli", "socketsecurity-cli-with-sentry"]
    releases = [("npm-release-tarballs", os.environ["ROOT_RECEIPT"],
                 {f"{package}-{version}.tgz" for package in packages})]
    # The host jobs need just the launcher. Collection jobs require the whole set.
    if "NATIVE_RECEIPTS" in os.environ:
        receipts = json.loads(os.environ["NATIVE_RECEIPTS"])
        targets = {"darwin-arm64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"} if prerelease else set()
        if set(receipts) != targets:
            raise SystemExit("Platform upload receipts do not match the release track.")
        for target in sorted(targets):
            releases.append((f"native-{target}", receipts[target],
                             {f"socketsecurity-socket-cli-{target}-{version}.tgz"}))
    destination = Path(os.environ["DIST_DIRECTORY"])
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as directory:
        for name, receipt, files in releases:
            download(receipt, name, files, destination, Path(directory))


if __name__ == "__main__":
    main()
