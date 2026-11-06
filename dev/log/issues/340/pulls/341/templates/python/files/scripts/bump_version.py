#!/usr/bin/env python3
"""
Bump version in pyproject.toml and update CHANGELOG.md

Usage:
    python scripts/bump_version.py <major|minor|patch> [--description "..."]

Examples:
    python scripts/bump_version.py patch
    python scripts/bump_version.py minor --description "Add new feature"
    python scripts/bump_version.py major --description "Breaking changes"
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path


def get_current_version(pyproject_path: Path) -> str:
    """Extract current version from pyproject.toml."""
    content = pyproject_path.read_text()
    match = re.search(r'^version\s*=\s*["\']([^"\']+)["\']', content, re.MULTILINE)
    if not match:
        raise ValueError("Could not find version in pyproject.toml")
    return match.group(1)


def bump_version(current: str, bump_type: str) -> str:
    """Bump version according to semantic versioning."""
    parts = current.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid version format: {current}")

    major, minor, patch = map(int, parts)

    if bump_type == "major":
        return f"{major + 1}.0.0"
    elif bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    elif bump_type == "patch":
        return f"{major}.{minor}.{patch + 1}"
    else:
        raise ValueError(f"Invalid bump type: {bump_type}")


def update_pyproject(pyproject_path: Path, old_version: str, new_version: str) -> None:
    """Update version in pyproject.toml."""
    content = pyproject_path.read_text()
    pattern = rf'^(version\s*=\s*["\']){re.escape(old_version)}(["\'])'
    new_content = re.sub(
        pattern, rf"\g<1>{new_version}\g<2>", content, flags=re.MULTILINE
    )

    if content == new_content:
        raise ValueError(
            f"Failed to update version from {old_version} to {new_version}"
        )

    pyproject_path.write_text(new_content)
    print(f"✓ Updated pyproject.toml: {old_version} → {new_version}")


def update_changelog(
    changelog_path: Path, version: str, bump_type: str, description: str
) -> None:
    """Update CHANGELOG.md with new version entry."""
    if not changelog_path.exists():
        print(f"Warning: {changelog_path} not found, skipping changelog update")
        return

    content = changelog_path.read_text()
    today = datetime.now().strftime("%Y-%m-%d")

    # Create new entry
    bump_type_title = bump_type.capitalize()
    new_entry = f"""## {version} - {today}

### {bump_type_title} Changes

- {description}

"""

    # Find insertion point (after first heading, before first version section)
    match = re.search(r"^## ", content, re.MULTILINE)

    if match:
        # Insert before first version section
        insert_pos = match.start()
        new_content = content[:insert_pos] + new_entry + content[insert_pos:]
    else:
        # If no version sections, insert after main heading
        main_heading_match = re.search(r"^# .+$", content, re.MULTILINE)
        if main_heading_match:
            insert_pos = main_heading_match.end()
            new_content = (
                content[:insert_pos] + "\n\n" + new_entry + content[insert_pos:]
            )
        else:
            # Prepend if no headings at all
            new_content = new_entry + "\n" + content

    changelog_path.write_text(new_content)
    print(f"✓ Updated {changelog_path.name}")


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Bump version and update changelog",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "bump_type",
        choices=["major", "minor", "patch"],
        help="Type of version bump",
    )
    parser.add_argument(
        "--description",
        "-d",
        default="",
        help="Description of changes for changelog",
    )
    parser.add_argument(
        "--skip-changelog",
        action="store_true",
        help="Leave changelog collection to the calling release script",
    )

    args = parser.parse_args()

    # Determine project root and files
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    pyproject_path = project_root / "pyproject.toml"
    changelog_path = project_root / "CHANGELOG.md"

    if not pyproject_path.exists():
        print(f"Error: {pyproject_path} not found", file=sys.stderr)
        return 1

    try:
        # Get current version
        old_version = get_current_version(pyproject_path)
        print(f"Current version: {old_version}")

        # Calculate new version
        new_version = bump_version(old_version, args.bump_type)
        print(f"New version: {new_version}")

        # Update files
        update_pyproject(pyproject_path, old_version, new_version)

        if not args.skip_changelog:
            description = args.description or f"Manual {args.bump_type} release"
            update_changelog(changelog_path, new_version, args.bump_type, description)

        print(f"\n✅ Version bump complete: {old_version} → {new_version}")
        print("\nNext steps:")
        print("  1. Review changes: git diff")
        print(
            "  2. Commit: git add . && git commit -m 'chore: bump version to {new_version}'"
        )
        print("  3. Tag: git tag v{new_version}")
        print("  4. Push: git push && git push --tags")

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
