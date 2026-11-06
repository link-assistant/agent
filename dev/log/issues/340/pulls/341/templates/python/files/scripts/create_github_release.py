#!/usr/bin/env python3
"""
Create a GitHub release from CHANGELOG.md content.

Usage:
    python scripts/create_github_release.py --version VERSION --repository REPO

Example:
    python scripts/create_github_release.py --version 1.2.3 --repository owner/repo

Environment variables:
    GH_TOKEN or GITHUB_TOKEN: GitHub token for authentication
"""

import argparse
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Optional, TextIO

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from check_release import get_github_release  # noqa: E402
from release_naming import (  # noqa: E402
    PYPROJECT_FILE,
    PythonLayout,
    build_pypi_badge,
    build_release_tag,
    build_release_title,
    detect_python_layout,
    has_release_badge,
    normalize_version,
)


MAX_RELEASE_NOTES_BYTES = 60_000
ENCODING = "utf-8"


def print_untrusted(text: str, file: Optional[TextIO] = None) -> None:
    """Print text while disabling GitHub runner command interpretation."""
    stream = sys.stdout if file is None else file
    if not os.environ.get("GITHUB_ACTIONS"):
        print(text, file=stream, flush=True)
        return

    # Use a fresh 128-bit token so repository-controlled text cannot guess the
    # resume command and re-enable parsing before the block has finished.
    token = secrets.token_hex(16)
    print(f"::stop-commands::{token}", file=stream, flush=True)
    print(text, file=stream, flush=True)
    print(f"::{token}::", file=stream, flush=True)


def run_command(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a command and handle errors."""
    print_untrusted(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)

    if result.stdout:
        print_untrusted(result.stdout)
    if result.stderr and result.returncode != 0:
        print_untrusted(result.stderr, file=sys.stderr)

    if check and result.returncode != 0:
        print(
            f"Error: Command failed with exit code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)

    return result


def extract_changelog_entry(changelog_path: Path, version: str) -> str:
    """Extract required notes, recognizing release headings outside fences only.

    Slice the original text without changing line endings or body indentation.
    Fences follow CommonMark's delimiter character, length and indentation rules.
    """
    content = changelog_path.read_bytes().decode(ENCODING)
    heading = re.compile(
        r"^ {0,3}##[ \t]+(?:\[(\d+\.\d+\.\d+[^\]\s]*)\]|"
        r"(\d+\.\d+\.\d+[^\s]*))(?:[ \t]+.*)?$"
    )
    fence: str | None = None
    offset = 0
    start: int | None = None
    end = len(content)
    for line in content.splitlines(keepends=True):
        text = line.rstrip("\r\n")
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", text)
        if fence:
            if (
                marker
                and marker[1][0] == fence[0]
                and len(marker[1]) >= len(fence)
                and not marker[2].strip()
            ):
                fence = None
        elif marker and (marker[1][0] != "`" or "`" not in marker[2]):
            fence = marker[1]
        else:
            match = heading.fullmatch(text)
            if match:
                if start is not None:
                    end = offset
                    break
                if (match[1] or match[2]) == version:
                    start = offset + len(line)
        offset += len(line)

    if start is None or not content[start:end].strip():
        msg = f"Required changelog entry for {version} is missing or empty in {changelog_path}"
        raise ValueError(msg)
    return content[start:end].strip("\r\n")


def append_pypi_badge_if_missing(
    release_notes: str,
    distribution_name: str,
    version: str,
) -> str:
    """Append a linked PyPI version badge unless a shields.io badge exists."""
    if has_release_badge(release_notes):
        return release_notes

    badge = build_pypi_badge(distribution_name, version)
    return f"{release_notes.rstrip()}\n\n{badge}"


def release_notes_size(release_notes: str) -> int:
    """Return the UTF-8 byte size of release notes."""
    return len(release_notes.encode(ENCODING))


def truncate_to_bytes(text: str, max_bytes: int) -> str:
    """Truncate text to a UTF-8 byte limit without splitting a character."""
    encoded = text.encode(ENCODING)
    if len(encoded) <= max_bytes:
        return text

    return encoded[:max_bytes].decode(ENCODING, errors="ignore")


def build_changelog_url(repository: str, tag: str) -> str:
    """Build a link to the changelog file at the release tag."""
    return f"https://github.com/{repository}/blob/{tag}/CHANGELOG.md"


def cap_release_notes(
    release_notes: str,
    repository: str,
    tag: str,
    max_bytes: int = MAX_RELEASE_NOTES_BYTES,
) -> str:
    """Cap release notes to a conservative byte limit and link the full changelog."""
    if release_notes_size(release_notes) <= max_bytes:
        return release_notes

    notice = (
        "\n\n---\n\n"
        "Release notes were truncated because the changelog entry is too large "
        "for GitHub Releases. See the full tagged CHANGELOG.md: "
        f"{build_changelog_url(repository, tag)}"
    )
    notice_size = release_notes_size(notice)

    if notice_size >= max_bytes:
        return truncate_to_bytes(notice.lstrip(), max_bytes).rstrip()

    preserved_notes = truncate_to_bytes(
        release_notes.rstrip(),
        max_bytes - notice_size,
    ).rstrip()
    return f"{preserved_notes}{notice}"


def create_release(
    version: str,
    repository: str,
    release_notes: str,
    prerelease: bool = False,
    distribution_name: str = "my-package",
    multi_language: bool = False,
) -> None:
    """Create or publish a draft release, preserving an already published release."""
    tag = build_release_tag(version, multi_language)
    existing = get_github_release(repository, tag)
    if existing is not None and not existing.get("draft", False):
        print(f"GitHub release {tag} already exists; keeping the published release")
        return
    title = build_release_title(version, distribution_name, multi_language)
    original_notes_size = release_notes_size(release_notes)
    release_notes = cap_release_notes(release_notes, repository, tag)
    capped_notes_size = release_notes_size(release_notes)

    print(f"\nCreating GitHub release for {tag}...")
    print(f"Repository: {repository}")
    print(f"Title: {title}")
    print(f"Prerelease: {prerelease}")
    if capped_notes_size < original_notes_size:
        print(
            "Release notes truncated from "
            f"{original_notes_size} to {capped_notes_size} bytes",
        )
    print("\nRelease notes:")
    print_untrusted(release_notes)
    print()

    cmd = [
        "gh",
        "release",
        "edit" if existing is not None else "create",
        tag,
        "--repo",
        repository,
        "--title",
        title,
        "--notes",
        release_notes,
    ]

    if existing is not None:
        cmd.append("--draft=false")

    if prerelease:
        cmd.append("--prerelease")

    run_command(cmd)
    print(f"\n✅ GitHub release {tag} created successfully!")


def get_pyproject_value(pyproject_path: Path, key: str) -> str:
    """Extract a top-level string value from pyproject.toml."""
    content = pyproject_path.read_text(encoding=ENCODING)
    match = re.search(
        rf"^{re.escape(key)}\s*=\s*[\"']([^\"']+)[\"']",
        content,
        re.MULTILINE,
    )
    if not match:
        msg = f"Could not find {key!r} in {pyproject_path}"
        raise ValueError(msg)
    return match.group(1)


def resolve_python_layout(repository_root: Path) -> PythonLayout:
    """Detect layout from the repository root, falling back to this script's root."""
    try:
        return detect_python_layout(repository_root)
    except FileNotFoundError:
        script_root = SCRIPT_DIR.parent
        if (script_root / PYPROJECT_FILE).is_file():
            return PythonLayout(root=script_root, multi_language=False)
        raise


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Create GitHub release from CHANGELOG.md",
    )
    parser.add_argument(
        "--version",
        "-v",
        required=True,
        help="Version to release (e.g., 1.2.3)",
    )
    parser.add_argument(
        "--repository",
        "-r",
        required=True,
        help="GitHub repository (owner/repo)",
    )
    parser.add_argument(
        "--prerelease",
        action="store_true",
        help="Mark as prerelease",
    )
    parser.add_argument(
        "--repository-root",
        default=".",
        help="Repository root used for Python layout auto-detection",
    )

    args = parser.parse_args()

    # Check for GitHub token
    if not os.environ.get("GH_TOKEN") and not os.environ.get("GITHUB_TOKEN"):
        print(
            "Error: GH_TOKEN or GITHUB_TOKEN environment variable required",
            file=sys.stderr,
        )
        return 1

    # Check if gh CLI is available
    result = run_command(["gh", "--version"], check=False)
    if result.returncode != 0:
        print(
            "Error: gh CLI not found. Install from https://cli.github.com/",
            file=sys.stderr,
        )
        return 1

    # Determine Python project root and package metadata.
    layout = resolve_python_layout(Path(args.repository_root))
    project_root = layout.root
    pyproject_path = project_root / PYPROJECT_FILE
    changelog_path = project_root / "CHANGELOG.md"

    try:
        bare_version = normalize_version(args.version)
        distribution_name = get_pyproject_value(pyproject_path, "name")
        release_notes = extract_changelog_entry(changelog_path, bare_version)
        release_notes = append_pypi_badge_if_missing(
            release_notes,
            distribution_name,
            bare_version,
        )

        create_release(
            bare_version,
            args.repository,
            release_notes,
            args.prerelease,
            distribution_name,
            layout.multi_language,
        )

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
