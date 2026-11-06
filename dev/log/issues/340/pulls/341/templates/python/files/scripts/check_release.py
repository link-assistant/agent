#!/usr/bin/env python3
"""Check release artifacts and wait for PyPI visibility after a successful upload.

Tags are not publication receipts: retry when either the exact PyPI version or
its published GitHub release is missing. The wait has a separate ten-minute
budget; pip's subsequent smoke test still verifies installation and imports.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import tomllib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from read_manifest import read_field
from release_naming import build_release_tag, detect_python_layout


REQUEST_TIMEOUT_SECONDS = 10
WAIT_TIMEOUT_SECONDS = 600
WAIT_INTERVAL_SECONDS = 15
MAX_RESPONSE_BYTES = 1024 * 1024


class ReleaseError(RuntimeError):
    """A release artifact could not be checked or became visible too late."""


class NoRedirects(HTTPRedirectHandler):
    """Keep authenticated GitHub requests on the original API host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Return no redirected request, including one that might carry a token."""
        return None


def request_json(
    url: str, *, token: str | None = None, timeout: float = REQUEST_TIMEOUT_SECONDS
) -> tuple[int, dict]:
    """GET a bounded JSON response; preserve HTTP status and close the response."""
    headers = {"Accept": "application/json", "User-Agent": "python-template-release"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with build_opener(NoRedirects()).open(request, timeout=timeout) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                message = f"Response from {url} exceeds the metadata size limit"
                raise ReleaseError(message)
            payload = json.loads(data)
            if not isinstance(payload, dict):
                message = f"Expected a JSON object from {url}"
                raise ReleaseError(message)
            return response.status, payload
    except HTTPError as error:
        error.close()
        return error.code, {}
    except (OSError, URLError, ValueError) as error:
        message = f"Could not read {url}: {error}"
        raise ReleaseError(message) from error


def pypi_url(package_name: str, version: str) -> str:
    """Return the exact release endpoint, with metadata encoded as path data."""
    return f"https://pypi.org/pypi/{quote(package_name, safe='')}/{quote(version, safe='')}/json"


def artifact_exists(status: int, label: str) -> bool:
    """Only an explicit not-found response proves an artifact is absent."""
    if status == 200:
        return True
    if status == 404:
        return False
    message = (
        f"Could not check {label}: HTTP {status}; refusing to assume it is missing"
    )
    raise ReleaseError(message)


def pypi_release_exists(package_name: str, version: str) -> bool:
    """Check the exact package version rather than a tag or version substring."""
    status, _ = request_json(pypi_url(package_name, version))
    return artifact_exists(status, f"{package_name}=={version} on PyPI")


def get_github_release(repository: str, tag: str) -> dict | None:
    """Get a release by tag, returning None only after an explicit API 404."""
    repository_path = "/".join(quote(part, safe="") for part in repository.split("/"))
    url = f"https://api.github.com/repos/{repository_path}/releases/tags/{quote(tag, safe='')}"
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    status, payload = request_json(url, token=token)
    return payload if artifact_exists(status, f"GitHub release {tag}") else None


def github_release_exists(repository: str, tag: str) -> bool:
    """Check a published GitHub release, independently of whether its tag exists."""
    release = get_github_release(repository, tag)
    return release is not None and not release.get("draft", False)


def check_release(repository_root: Path, repository: str) -> dict[str, str]:
    """Return workflow outputs for repairing either missing publication artifact."""
    layout = detect_python_layout(repository_root)
    with (layout.root / "pyproject.toml").open("rb") as stream:
        manifest = tomllib.load(stream)
    name = read_field(manifest, "project.name")
    version = read_field(manifest, "project.version")
    for value in (name, version):
        if not value.strip() or "\n" in value or "\r" in value:
            message = "Package name and version must be nonempty single-line values"
            raise ReleaseError(message)
    tag = build_release_tag(version, layout.multi_language)
    pypi_exists = pypi_release_exists(name, version)
    github_exists = github_release_exists(repository, tag)
    should_release = not (pypi_exists and github_exists)
    print(
        f"Release {tag}: PyPI={pypi_exists}, GitHub={github_exists}, resume={should_release}"
    )
    return {
        "current_version": version,
        "package_name": name,
        "tag": tag,
        "pypi_exists": str(pypi_exists).lower(),
        "github_release_exists": str(github_exists).lower(),
        "should_release": str(should_release).lower(),
    }


def wait_for_pypi(
    package_name: str,
    version: str,
    *,
    timeout_seconds: float = WAIT_TIMEOUT_SECONDS,
    interval_seconds: float = WAIT_INTERVAL_SECONDS,
    verbose: bool = False,
) -> None:
    """Poll the version endpoint within a finite budget, retrying transient errors."""
    if any(
        not math.isfinite(value) or value <= 0
        for value in (timeout_seconds, interval_seconds)
    ):
        message = "Wait timeout and interval must be positive finite numbers"
        raise ReleaseError(message)
    deadline = time.monotonic() + timeout_seconds
    url = pypi_url(package_name, version)
    print(f"Waiting up to {timeout_seconds:g}s for {package_name}=={version} on PyPI")
    last_error = "version not visible"
    while (remaining := deadline - time.monotonic()) > 0:
        try:
            status, _ = request_json(
                url, timeout=min(REQUEST_TIMEOUT_SECONDS, remaining)
            )
        except ReleaseError as error:
            last_error = str(error)
        else:
            if status == 200:
                print(f"PyPI now serves {package_name}=={version}")
                return
            last_error = f"HTTP {status}"
            if status not in (404, 429) and not 500 <= status <= 599:
                message = f"PyPI visibility check failed: {last_error}"
                raise ReleaseError(message)
        if verbose:
            print(
                f"PyPI not ready: {last_error}; {max(0, deadline - time.monotonic()):g}s remaining"
            )
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(interval_seconds, remaining))
    message = (
        f"The upload step succeeded, but {package_name}=={version} was not visible "
        f"on PyPI within {timeout_seconds:g}s ({last_error}). Rerun the release; "
        "existing uploads will be skipped and missing artifacts repaired."
    )
    raise ReleaseError(message)


def main(argv: list[str] | None = None) -> int:
    """Run a release artifact check or a bounded post-upload visibility wait."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check", help="Check both publication artifacts")
    check.add_argument("--repository", required=True)
    check.add_argument("--repository-root", type=Path, default=Path.cwd())
    wait = commands.add_parser("wait", help="Wait for an uploaded version on PyPI")
    wait.add_argument("--package-name", required=True)
    wait.add_argument("--version", required=True)
    wait.add_argument("--timeout-seconds", type=float, default=WAIT_TIMEOUT_SECONDS)
    wait.add_argument("--interval-seconds", type=float, default=WAIT_INTERVAL_SECONDS)
    wait.add_argument(
        "--verbose", action="store_true", help="Print each retry (off by default)"
    )
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            outputs = check_release(args.repository_root, args.repository)
            output_path = os.environ.get("GITHUB_OUTPUT")
            if output_path:
                with Path(output_path).open("a", encoding="utf-8") as stream:
                    for key, value in outputs.items():
                        stream.write(f"{key}={value}\n")
        else:
            wait_for_pypi(
                args.package_name,
                args.version,
                timeout_seconds=args.timeout_seconds,
                interval_seconds=args.interval_seconds,
                verbose=args.verbose,
            )
        return 0
    except (ReleaseError, OSError, ValueError, KeyError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
