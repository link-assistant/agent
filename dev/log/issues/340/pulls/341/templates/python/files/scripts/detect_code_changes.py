#!/usr/bin/env python3
"""
Detect code changes for CI/CD pipeline.

This script detects what types of files have changed between two commits
and outputs the results for use in GitHub Actions workflow conditions.

Key behavior:
- For PRs: compares PR head against base branch
- For pushes: compares HEAD against HEAD^
- Excludes certain folders and file types from "code changes" detection

Excluded from code changes (don't require changelog fragments):
- Markdown files (*.md) in any folder
- changelog.d/ folder (changelog metadata)
- dev/log/ folder (development logs)
- docs/ folder (documentation)
- experiments/ folder (experimental scripts)
- examples/ folder (example scripts)

Usage:
    python scripts/detect_code_changes.py

Environment variables (set by GitHub Actions):
    - GITHUB_EVENT_NAME: 'pull_request' or 'push'
    - GITHUB_BASE_SHA: Base commit SHA for PR
    - GITHUB_HEAD_SHA: Head commit SHA for PR

Outputs (written to GITHUB_OUTPUT):
    - any-code-changed: 'true' if any code files changed outside excluded paths
    - docs-changed: 'true' if any markdown file or file under docs/ changed
"""

from __future__ import annotations

import os
import subprocess
import sys

EXCLUDED_FOLDERS = (
    "changelog.d/",
    "dev/log/",
    "docs/",
    "examples/",
    "experiments/",
)
CODE_EXTENSIONS = (".py", ".sh", ".json", ".toml", ".yml", ".yaml")


def exec_command(command: str) -> str:
    """Execute a shell command and return trimmed output."""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {command}", file=sys.stderr)
        print(f"stderr: {e.stderr}", file=sys.stderr)
        return ""


def set_output(name: str, value: str) -> None:
    """Write output to GitHub Actions output file."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a") as f:
            f.write(f"{name}={value}\n")
    print(f"{name}={value}")


def get_changed_files() -> list[str]:
    """Get the list of changed files between two commits."""
    event_name = os.environ.get("GITHUB_EVENT_NAME", "local")

    if event_name == "pull_request":
        base_sha = os.environ.get("GITHUB_BASE_SHA")
        head_sha = os.environ.get("GITHUB_HEAD_SHA")

        if base_sha and head_sha:
            print(f"Comparing PR: {base_sha}...{head_sha}")
            try:
                # Ensure we have the base commit
                try:
                    subprocess.run(
                        f"git cat-file -e {base_sha}",
                        shell=True,
                        check=True,
                        capture_output=True,
                    )
                except subprocess.CalledProcessError:
                    print("Base commit not available locally, attempting fetch...")
                    subprocess.run(
                        f"git fetch origin {base_sha}",
                        shell=True,
                        check=False,
                    )

                output = exec_command(f"git diff --name-only {base_sha} {head_sha}")
                if output:
                    return [f for f in output.split("\n") if f]
            except (OSError, subprocess.SubprocessError) as e:
                print(f"Git diff failed: {e}", file=sys.stderr)

    # For push events or fallback
    print("Comparing HEAD^ to HEAD")
    try:
        output = exec_command("git diff --name-only HEAD^ HEAD")
        if output:
            return [f for f in output.split("\n") if f]
    except (OSError, subprocess.SubprocessError):
        # If HEAD^ doesn't exist (first commit), list all files in HEAD
        print("HEAD^ not available, listing all files in HEAD")
        output = exec_command("git ls-tree --name-only -r HEAD")
        if output:
            return [f for f in output.split("\n") if f]

    return []


def is_excluded_from_code_changes(file_path: str) -> bool:
    """Check if a file should be excluded from code changes detection."""
    if file_path.endswith(".md"):
        return True

    relative_path = file_path.removeprefix("python/")
    return relative_path.startswith(EXCLUDED_FOLDERS)


def is_docs_change(file_path: str) -> bool:
    """Check if a file is a documentation change (issue #72).

    Documentation-only pull requests skip the changelog-fragment requirement,
    so they need their own gate: markdown anywhere, or anything under docs/.
    """
    if file_path.endswith(".md"):
        return True
    return file_path.removeprefix("python/").startswith("docs/")


def detect_change_types(
    changed_files: list[str], *, event_name: str
) -> dict[str, bool]:
    """Classify changed files for job gating on an automatic event."""
    if event_name not in {"pull_request", "push"}:
        message = f"Unsupported automatic event: {event_name}"
        raise ValueError(message)

    code_changed = any(
        (
            file_path.endswith(CODE_EXTENSIONS)
            or file_path.startswith(".github/workflows/")
        )
        and not is_excluded_from_code_changes(file_path)
        for file_path in changed_files
    )
    docs_changed = any(is_docs_change(file_path) for file_path in changed_files)
    return {"any-code-changed": code_changed, "docs-changed": docs_changed}


def detect_changes() -> None:
    """Main function to detect changes."""
    print("Detecting file changes for CI/CD...\n")

    changed_files = get_changed_files()

    print("Changed files:")
    if not changed_files:
        print("  (none)")
    else:
        for file in changed_files:
            print(f"  {file}")
    print()

    code_changed_files = [
        f for f in changed_files if not is_excluded_from_code_changes(f)
    ]

    print("\nFiles considered as code changes:")
    if not code_changed_files:
        print("  (none)")
    else:
        for file in code_changed_files:
            print(f"  {file}")
    print()

    event_name = os.environ.get("GITHUB_EVENT_NAME", "push")
    outputs = detect_change_types(changed_files, event_name=event_name)
    for name, value in outputs.items():
        set_output(name, "true" if value else "false")

    print("\nChange detection completed.")


if __name__ == "__main__":
    detect_changes()
