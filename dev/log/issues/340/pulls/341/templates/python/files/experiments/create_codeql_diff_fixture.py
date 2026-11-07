#!/usr/bin/env python3
"""Create 301 tiny evidence files for a hosted CodeQL compare-limit regression.

Commit the generated directory on the PR branch, verify the hosted CodeQL run,
then revert that fixture commit. The final PR need not retain the generated files.
"""

from pathlib import Path


def main() -> None:
    """Generate a finite fixture, refusing to overwrite existing evidence."""
    directory = Path(__file__).resolve().parent / "issue_126_large_diff"
    directory.mkdir()
    for number in range(301):
        (directory / f"evidence-{number:03d}.txt").write_text(
            f"CodeQL full-analysis regression evidence file {number}.\n",
            encoding="utf-8",
        )
    print(f"Created 301 files in {directory}")


if __name__ == "__main__":
    main()
