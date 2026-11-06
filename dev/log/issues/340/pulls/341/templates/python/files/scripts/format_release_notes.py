#!/usr/bin/env python3
"""
Format GitHub release notes with enhanced information.

This script is the Python equivalent of format-release-notes.mjs from the JS template.
It enhances GitHub release notes with:
- PyPI version badge
- Link to associated pull request
- Clean formatting

Usage:
    python scripts/format_release_notes.py --release-id <id> --version <version> \\
        --repository <owner/repo> [--commit-sha <sha>]

Example:
    python scripts/format_release_notes.py --release-id 12345 --version 1.0.0 \\
        --repository link-foundation/my-package --commit-sha abc123
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from release_naming import (  # noqa: E402
    PYPROJECT_FILE,
    build_pypi_badge,
    detect_python_layout,
    has_release_badge,
    normalize_version,
)


def run_gh_command(args: list[str]) -> tuple[bool, str]:
    """Run a gh CLI command and return (success, output)."""
    try:
        result = subprocess.run(
            ["gh"] + args,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return False, result.stderr
        return True, result.stdout
    except FileNotFoundError:
        return False, "gh CLI not found. Install from https://cli.github.com/"


def get_release_body(repository: str, release_id: str) -> tuple[bool, str]:
    """Get the body of a GitHub release."""
    success, output = run_gh_command(
        ["api", f"repos/{repository}/releases/{release_id}", "--jq", ".body"]
    )
    return success, output.strip() if success else output


def find_pr_for_commit(repository: str, commit_sha: str) -> Optional[str]:
    """Find the pull request that contains a specific commit."""
    if not commit_sha:
        return None

    success, output = run_gh_command(
        [
            "api",
            f"repos/{repository}/commits/{commit_sha}/pulls",
            "--jq",
            ".[0].number",
        ]
    )

    if success and output.strip():
        try:
            pr_number = int(output.strip())
            return str(pr_number)
        except ValueError:
            pass

    return None


def format_release_body(
    body: str,
    version: str,
    repository: str,
    pr_number: Optional[str],
    package_name: str,
) -> str:
    """Format the release body with enhanced information."""
    # Check if already formatted (has PyPI badge)
    if has_release_badge(body, include_project_link=True):
        print("Release notes already formatted, skipping")
        return body

    formatted_parts = []

    # Add PyPI badge
    pypi_badge = build_pypi_badge(package_name, version)
    formatted_parts.append(pypi_badge)
    formatted_parts.append("")

    # Add PR link if available
    if pr_number:
        pr_link = f"**Pull Request:** [#{pr_number}](https://github.com/{repository}/pull/{pr_number})"
        formatted_parts.append(pr_link)
        formatted_parts.append("")

    # Clean up the existing body
    cleaned_body = body.strip()

    # Fix escaped newlines and special characters
    cleaned_body = cleaned_body.replace("\\n", "\n")
    cleaned_body = cleaned_body.replace("\\r", "")
    cleaned_body = cleaned_body.replace('\\"', '"')

    # Remove duplicate version headers if present
    bare_version = normalize_version(version)
    version_pattern = rf"^#+\s*v?{re.escape(bare_version)}\s*$"
    cleaned_body = re.sub(version_pattern, "", cleaned_body, flags=re.MULTILINE)

    # Clean up excessive whitespace
    cleaned_body = re.sub(r"\n{3,}", "\n\n", cleaned_body)
    cleaned_body = cleaned_body.strip()

    if cleaned_body:
        formatted_parts.append(cleaned_body)

    return "\n".join(formatted_parts)


def update_release(repository: str, release_id: str, new_body: str) -> bool:
    """Update the release body on GitHub."""
    # Use gh api to update the release
    success, output = run_gh_command(
        [
            "api",
            "-X",
            "PATCH",
            f"repos/{repository}/releases/{release_id}",
            "-f",
            f"body={new_body}",
        ]
    )

    if not success:
        print(f"Error updating release: {output}", file=sys.stderr)
        return False

    return True


def get_package_name() -> str:
    """Get the package name from pyproject.toml."""
    try:
        layout = detect_python_layout()
        pyproject_path = layout.root / PYPROJECT_FILE
        content = pyproject_path.read_text(encoding="utf-8")
        match = re.search(r'^name\s*=\s*["\']([^"\']+)["\']', content, re.MULTILINE)
        if match:
            return match.group(1)
    except FileNotFoundError:
        pass

    return "my-package"


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Format GitHub release notes with enhanced information",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--release-id",
        required=True,
        help="GitHub release ID",
    )
    parser.add_argument(
        "--version",
        required=True,
        help="Release version (e.g., 1.0.0)",
    )
    parser.add_argument(
        "--repository",
        required=True,
        help="Repository in owner/repo format",
    )
    parser.add_argument(
        "--commit-sha",
        default="",
        help="Commit SHA to find associated PR",
    )
    parser.add_argument(
        "--package-name",
        default="",
        help="Package name for PyPI badge (auto-detected from pyproject.toml if not provided)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print formatted notes without updating release",
    )

    args = parser.parse_args()

    # Get package name
    package_name = args.package_name or get_package_name()
    print(f"Package name: {package_name}")

    # Get current release body
    print(f"Fetching release {args.release_id}...")
    success, body = get_release_body(args.repository, args.release_id)
    if not success:
        print(f"Error fetching release: {body}", file=sys.stderr)
        return 1

    print(f"Current body length: {len(body)} characters")

    # Find associated PR
    pr_number = None
    if args.commit_sha:
        print(f"Looking for PR associated with commit {args.commit_sha}...")
        pr_number = find_pr_for_commit(args.repository, args.commit_sha)
        if pr_number:
            print(f"Found PR: #{pr_number}")
        else:
            print("No associated PR found")

    # Format the release body
    formatted_body = format_release_body(
        body,
        args.version,
        args.repository,
        pr_number,
        package_name,
    )

    if args.dry_run:
        print("\n--- Formatted Release Notes ---")
        print(formatted_body)
        print("--- End ---\n")
        return 0

    # Update release
    if formatted_body != body:
        print("Updating release notes...")
        if update_release(args.repository, args.release_id, formatted_body):
            print("Release notes updated successfully!")
            return 0
        else:
            return 1
    else:
        print("No changes needed")
        return 0


if __name__ == "__main__":
    sys.exit(main())
