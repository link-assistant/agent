#!/usr/bin/env python3
"""Verify actionlint exempts documented queue syntax but rejects other keys.

Usage: python experiments/reproduce_actionlint_queue.py /path/to/actionlint
Uses the repository's configuration in an isolated fixture; no network access.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    """Run both schema controls with the same actionlint configuration as CI."""
    binary = shutil.which(sys.argv[1] if len(sys.argv) > 1 else "actionlint")
    if binary is None:
        sys.exit("Install actionlint 1.7.12 or supply its executable path.")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        subprocess.run(["git", "init", "--quiet", str(root)], check=True, timeout=15)
        workflows = root / ".github/workflows"
        workflows.mkdir(parents=True)
        shutil.copy2(ROOT / ".github/actionlint.yaml", root / ".github/actionlint.yaml")
        path = workflows / "fixture.yml"
        for key, expected in (("queue", 0), ("queue-size", 1)):
            path.write_text(
                "name: Queue fixture\non: push\njobs:\n  writer:\n"
                "    runs-on: ubuntu-24.04\n    concurrency:\n"
                "      group: writer\n      cancel-in-progress: false\n"
                f"      {key}: max\n    steps:\n      - run: 'true'\n"
            )
            result = subprocess.run(
                [binary, str(path)],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=15,
            )
            print(f"{key}: exit {result.returncode}")
            if result.returncode != expected:
                sys.exit(result.stdout + result.stderr or "unexpected lint result")
            if expected and 'unexpected key "queue-size"' not in result.stdout:
                sys.exit("negative control did not report the unknown key")


if __name__ == "__main__":
    main()
