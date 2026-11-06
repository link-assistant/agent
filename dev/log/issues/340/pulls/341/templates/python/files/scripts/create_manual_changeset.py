#!/usr/bin/env python3
"""
Create a manual changelog fragment for releases.

This script is the Python equivalent of create-manual-changeset.mjs from the JS template.
It creates a changelog fragment in the changelog.d/ directory for documenting changes.

Usage:
    python scripts/create_manual_changeset.py <major|minor|patch> [--description "..."]

Examples:
    python scripts/create_manual_changeset.py patch
    python scripts/create_manual_changeset.py minor --description "Add new feature"
    python scripts/create_manual_changeset.py major --description "Breaking changes"

Note: This wraps 'scriv create' but can also create fragments manually if scriv
is not installed.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def get_branch_name() -> str:
    """Get current git branch name."""
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "manual"


def get_username() -> str:
    """Get current user name for fragment filename."""
    # Try git user.name first
    try:
        result = subprocess.run(
            ["git", "config", "user.name"],
            capture_output=True,
            text=True,
            check=True,
        )
        username = result.stdout.strip()
        if username:
            # Sanitize username for filename
            return re.sub(r"[^a-zA-Z0-9_-]", "_", username).lower()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    # Fall back to environment variable or default
    return os.environ.get("USER", os.environ.get("USERNAME", "user")).lower()


def has_scriv() -> bool:
    """Check if scriv is installed."""
    return shutil.which("scriv") is not None


def create_with_scriv(bump_type: str, description: str) -> int:
    """Create fragment using scriv create command."""
    print("Using scriv to create changelog fragment...")

    try:
        result = subprocess.run(
            ["scriv", "create"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            print(f"Warning: scriv create returned non-zero: {result.stderr}")
            return result.returncode

        print(result.stdout)

        # Find the created fragment
        changelog_dir = Path("changelog.d")
        if changelog_dir.exists():
            fragments = sorted(
                [
                    f
                    for f in changelog_dir.glob("*.md")
                    if f.name != "README.md" and not f.name.endswith(".j2")
                ],
                key=lambda x: x.stat().st_mtime,
                reverse=True,
            )

            if fragments:
                fragment_path = fragments[0]
                print(f"\nCreated fragment: {fragment_path}")
                print("\nPlease edit the fragment file to document your changes.")

                if description:
                    # Update fragment with provided description
                    bump_category = {
                        "major": "Changed",  # Major = breaking changes
                        "minor": "Added",  # Minor = new features
                        "patch": "Fixed",  # Patch = bug fixes
                    }.get(bump_type, "Changed")

                    # Add the description under the appropriate category
                    new_content = f"### {bump_category}\n\n- {description}\n"
                    fragment_path.write_text(new_content)
                    print(f"Updated fragment with {bump_type} change: {description}")

        return 0

    except FileNotFoundError:
        print("Error: scriv command not found")
        return 1


def create_manual_fragment(
    changelog_dir: Path, bump_type: str, description: str
) -> int:
    """Create a changelog fragment manually without scriv."""
    # Generate filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    username = get_username()
    branch = get_branch_name()

    # Sanitize branch name
    safe_branch = re.sub(r"[^a-zA-Z0-9_-]", "_", branch)

    filename = f"{timestamp}_{username}_{safe_branch}.md"
    fragment_path = changelog_dir / filename

    # Determine category based on bump type
    bump_category = {
        "major": "Changed",  # Major = breaking changes
        "minor": "Added",  # Minor = new features
        "patch": "Fixed",  # Patch = bug fixes
    }.get(bump_type, "Changed")

    # Create fragment content
    if description:
        content = f"### {bump_category}\n\n- {description}\n"
    else:
        content = """<!--
Uncomment the relevant sections below and describe your changes.
Delete any sections you don't need.
-->

### Added

- New feature description

### Changed

- Change to existing functionality

### Fixed

- Bug fix description

<!--
### Removed

- Removed feature

### Deprecated

- Deprecated feature

### Security

- Security fix
-->
"""

    fragment_path.write_text(content)
    print(f"Created changelog fragment: {fragment_path}")

    if not description:
        print("\nPlease edit the fragment file to document your changes.")
        print(f"  File: {fragment_path}")

    return 0


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Create a changelog fragment for release documentation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
This script creates a changelog fragment in changelog.d/ to document changes.
It's the Python equivalent of 'npx changeset' in JavaScript projects.

The fragment will be collected into CHANGELOG.md during release.
        """,
    )
    parser.add_argument(
        "bump_type",
        choices=["major", "minor", "patch"],
        help="Type of version bump (determines default category)",
    )
    parser.add_argument(
        "--description",
        "-d",
        default="",
        help="Description of changes (optional, can edit file later)",
    )
    parser.add_argument(
        "--no-scriv",
        action="store_true",
        help="Create fragment manually without using scriv",
    )

    args = parser.parse_args()

    # Determine project root and changelog directory
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    changelog_dir = project_root / "changelog.d"

    # Ensure changelog directory exists
    if not changelog_dir.exists():
        changelog_dir.mkdir(parents=True)
        print(f"Created directory: {changelog_dir}")

    # Use scriv if available, unless --no-scriv is specified
    if has_scriv() and not args.no_scriv:
        return create_with_scriv(args.bump_type, args.description)
    else:
        if not args.no_scriv:
            print("Note: scriv not found, creating fragment manually")
            print(
                "Install scriv for better fragment management: pip install scriv[toml]"
            )
            print()
        return create_manual_fragment(changelog_dir, args.bump_type, args.description)


if __name__ == "__main__":
    sys.exit(main())
