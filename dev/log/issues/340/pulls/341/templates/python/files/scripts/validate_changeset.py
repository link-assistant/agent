#!/usr/bin/env python3
"""Validate newly added changelog fragments against a verified PR merge base.

Source changes under src/, tests/ or scripts/ require a new changelog.d/*.md
fragment. Markdown documentation, examples and experiments remain exempt.
Only committed additions count; inherited, edited-in-place and unchanged moved
fragments do not. Replacements with different content count as additions.
Every added fragment must contain a visible category and a description.

Usage:
    python scripts/validate_changeset.py --base-ref origin/main --head-ref HEAD

Refs default to GITHUB_BASE_SHA (or origin/GITHUB_BASE_REF, then origin/main)
and GITHUB_HEAD_SHA (or HEAD). Both refs and their merge base must exist locally;
use a full-history checkout in CI. No network fetch or fallback diff is attempted.
Use --verbose to print Git commands while investigating a failed comparison.

Exit codes:
    0 - Valid new fragments, or no source changes and no invalid new fragments
    1 - Missing/invalid fragment, missing ref, or failed Git comparison
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

CATEGORY_PATTERN = re.compile(
    r"^###\s+(Added|Changed|Deprecated|Fixed|Removed|Security)\s*$", re.IGNORECASE
)


def validate_content(name: str, content: str) -> tuple[bool, str]:
    """Require a visible category with a nonempty description beneath it."""
    if not content.strip():
        return False, f"Fragment {name} is empty"

    visible_content = re.sub(r"<!--.*?(?:-->|\Z)", "", content, flags=re.DOTALL)
    in_category = False
    found_category = False
    for line in visible_content.splitlines():
        line = line.strip()
        if line.startswith("#"):
            in_category = bool(CATEGORY_PATTERN.fullmatch(line))
            found_category |= in_category
        elif in_category and line.strip(" -*+\t"):
            return True, ""

    if not found_category:
        return False, (
            f"Fragment {name} missing category heading.\n"
            "Expected one of: ### Added, ### Changed, ### Deprecated, "
            "### Fixed, ### Removed, ### Security"
        )
    return False, (
        f"Fragment {name} has no content.\n"
        "Please add a description of your changes under the appropriate category."
    )


def validate_fragment_content(fragment_path: Path) -> tuple[bool, str]:
    """Validate a local fragment's UTF-8 content."""
    return validate_content(
        fragment_path.name, fragment_path.read_text(encoding="utf-8")
    )


def run_git(project_root: Path, *args: str, verbose: bool = False) -> str:
    """Run Git without shell interpolation, propagating comparison failures."""
    if verbose:
        print(f"[git] {args!r}", file=sys.stderr)
    result = subprocess.run(
        ["git", *args],
        cwd=project_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return result.stdout


def get_comparison(
    project_root: Path, base_ref: str, head_ref: str, *, verbose: bool = False
) -> tuple[Path, str, str]:
    """Resolve both commits and require their common ancestor."""
    repo_root = Path(run_git(project_root, "rev-parse", "--show-toplevel").strip())
    base_sha = run_git(
        project_root,
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{base_ref}^{{commit}}",
        verbose=verbose,
    ).strip()
    head_sha = run_git(
        project_root,
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{head_ref}^{{commit}}",
        verbose=verbose,
    ).strip()
    merge_base = run_git(
        project_root, "merge-base", base_sha, head_sha, verbose=verbose
    ).strip()
    print(f"Comparing merge base {merge_base} to head {head_sha}")
    return repo_root, merge_base, head_sha


def get_diff_files(
    repo_root: Path,
    merge_base: str,
    head_sha: str,
    *,
    additions: bool = False,
    verbose: bool = False,
) -> list[str]:
    """Read NUL-delimited paths, retaining both endpoints of source renames."""
    # Exclude unchanged moves without hiding similar replacement fragments.
    options = (
        ("--find-renames=100%", "--diff-filter=A") if additions else ("--no-renames",)
    )
    output = run_git(
        repo_root,
        "diff",
        "--name-only",
        "-z",
        *options,
        merge_base,
        head_sha,
        "--",
        verbose=verbose,
    )
    return [name for name in output.split("\0") if name]


def get_pr_changes(
    project_root: Path, base_ref: str, head_ref: str, *, verbose: bool = False
) -> tuple[Path, str, list[str], list[str]]:
    """Return the verified head SHA, source paths and added fragment paths."""
    repo_root, merge_base, head_sha = get_comparison(
        project_root, base_ref, head_ref, verbose=verbose
    )
    prefix = project_root.relative_to(repo_root).as_posix()
    prefix = "" if prefix == "." else f"{prefix}/"
    source_folders = tuple(
        f"{prefix}{folder}/" for folder in ("src", "tests", "scripts")
    )
    # Git emits repository-relative paths even in the python/ layout.
    changed = get_diff_files(repo_root, merge_base, head_sha, verbose=verbose)
    added = get_diff_files(
        repo_root, merge_base, head_sha, additions=True, verbose=verbose
    )
    sources = [
        name
        for name in changed
        if name.startswith(source_folders) and not name.endswith(".md")
    ]
    fragments = [
        name
        for name in added
        if PurePosixPath(name).parent.as_posix() == f"{prefix}changelog.d"
        and name.endswith(".md")
        and PurePosixPath(name).name != "README.md"
    ]
    return repo_root, head_sha, sources, fragments


def validate_pr(
    project_root: Path, base_ref: str, head_ref: str, *, verbose: bool = False
) -> int:
    """Enforce the fragment requirement and validate additions at the PR head."""
    repo_root, head_sha, sources, fragments = get_pr_changes(
        project_root, base_ref, head_ref, verbose=verbose
    )
    print(f"Found {len(sources)} source change(s) and {len(fragments)} new fragment(s)")
    if sources and not fragments:
        print("::error::No new changelog fragment found for source changes.")
        print("Run 'scriv create', describe your changes, and commit the new fragment.")
        print("See changelog.d/README.md for more information.")
        return 1

    if not sources:
        print("No source changes; a new fragment is optional.")

    all_valid = True
    for fragment in fragments:
        content = run_git(repo_root, "show", f"{head_sha}:{fragment}", verbose=verbose)
        is_valid, error = validate_content(PurePosixPath(fragment).name, content)
        if is_valid:
            print(f"  [OK] {PurePosixPath(fragment).name}")
        else:
            print(f"  [FAIL] {error}")
            all_valid = False

    print(
        "Changelog validation passed!" if all_valid else "Changelog validation FAILED!"
    )
    return 0 if all_valid else 1


def main(argv: list[str] | None = None) -> int:
    """Parse local/CI refs and fail closed when validation cannot complete."""
    base_branch = os.environ.get("GITHUB_BASE_REF")
    default_base = os.environ.get("GITHUB_BASE_SHA") or (
        f"origin/{base_branch}" if base_branch else "origin/main"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default=default_base)
    parser.add_argument(
        "--head-ref", default=os.environ.get("GITHUB_HEAD_SHA") or "HEAD"
    )
    parser.add_argument("--verbose", action="store_true", help="Print Git commands")
    args = parser.parse_args(argv)
    # The workflow supplies the authenticated PR author, never a branch name.
    if os.environ.get("PR_AUTHOR") == "dependabot[bot]":
        print("Skipping: PR opened by dependabot[bot]")
        return 0
    project_root = Path(__file__).resolve().parents[1]
    try:
        return validate_pr(
            project_root, args.base_ref, args.head_ref, verbose=args.verbose
        )
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as error:
        detail = (
            error.stderr.strip()
            if isinstance(error, subprocess.CalledProcessError)
            else str(error)
        )
        print(f"Cannot validate changelog: {detail or error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
