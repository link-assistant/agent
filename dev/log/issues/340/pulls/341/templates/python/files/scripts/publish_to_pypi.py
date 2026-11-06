#!/usr/bin/env python3
"""
Build and publish package to PyPI using trusted publishing (OIDC).

This script:
1. Cleans previous build artifacts
2. Builds the package using hatchling
3. Validates the built distribution
4. Publishes to PyPI using OIDC (no token needed in CI)

Usage:
    python scripts/publish_to_pypi.py [--dry-run]

Note: In GitHub Actions, this uses OIDC trusted publishing.
      For local testing, use --dry-run or set TWINE_USERNAME/TWINE_PASSWORD.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def run_command(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a command and handle errors."""
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)

    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)

    if check and result.returncode != 0:
        print(
            f"Error: Command failed with exit code {result.returncode}", file=sys.stderr
        )
        sys.exit(result.returncode)

    return result


def clean_build_artifacts(project_root: Path) -> None:
    """Remove previous build artifacts."""
    print("Cleaning build artifacts...")
    dirs_to_remove = ["dist", "build", "*.egg-info"]

    for pattern in dirs_to_remove:
        if "*" in pattern:
            for path in project_root.glob(pattern):
                if path.is_dir():
                    shutil.rmtree(path)
                    print(f"  Removed: {path}")
        else:
            path = project_root / pattern
            if path.exists():
                shutil.rmtree(path)
                print(f"  Removed: {path}")


def build_package(project_root: Path) -> None:
    """Build the package using python -m build."""
    print("\nBuilding package...")
    run_command([sys.executable, "-m", "build", str(project_root)])


def check_package(dist_dir: Path) -> None:
    """Validate the built package using twine."""
    print("\nValidating package...")
    dist_files = list(dist_dir.glob("*"))

    if not dist_files:
        print("Error: No distribution files found in dist/", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(dist_files)} distribution file(s):")
    for file in dist_files:
        print(f"  - {file.name}")

    run_command([sys.executable, "-m", "twine", "check"] + [str(f) for f in dist_files])


def publish_package(dist_dir: Path, dry_run: bool = False) -> None:
    """Publish package to PyPI."""
    dist_files = list(dist_dir.glob("*"))

    if not dist_files:
        print("Error: No distribution files found in dist/", file=sys.stderr)
        sys.exit(1)

    if dry_run:
        print("\n[DRY RUN] Would publish the following files:")
        for file in dist_files:
            print(f"  - {file.name}")
        print("\nSkipping actual upload (dry run mode)")
        return

    print("\nPublishing to PyPI...")

    # Use twine upload with OIDC if in CI, otherwise use credentials
    cmd = [sys.executable, "-m", "twine", "upload", "--skip-existing"]
    cmd.extend([str(f) for f in dist_files])

    run_command(cmd)
    print("\n✅ Package published successfully!")


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Build and publish package to PyPI",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and validate but don't publish",
    )

    args = parser.parse_args()

    # Determine project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    dist_dir = project_root / "dist"

    try:
        # Ensure required tools are available
        for tool in ["build", "twine"]:
            result = run_command(
                [sys.executable, "-m", tool, "--version"],
                check=False,
            )
            if result.returncode != 0:
                print(
                    f"Error: {tool} is not installed. Install with: pip install {tool}",
                    file=sys.stderr,
                )
                return 1

        # Clean, build, check
        clean_build_artifacts(project_root)
        build_package(project_root)
        check_package(dist_dir)

        # Publish (unless dry run)
        publish_package(dist_dir, dry_run=args.dry_run)

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
