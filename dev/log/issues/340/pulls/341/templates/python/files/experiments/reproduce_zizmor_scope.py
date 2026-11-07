"""Reproduce #102 with zizmor 1.30.1 and a temporary Dependabot configuration.

Install zizmor==1.30.1 and put it on PATH, then run:
    python experiments/reproduce_zizmor_scope.py

The workflows-only scan passes without a cooldown. The repository scan finds
the missing cooldown, then passes after default-days: 7 is added.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPENDABOT = """version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
"""
WORKFLOW = """name: Reproduce
on: push
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ok
"""


def audit(root: Path, target: str) -> subprocess.CompletedProcess[str]:
    """Audit one input with the same version, policy and filters as CI."""
    result = subprocess.run(
        [
            "zizmor",
            "--offline",
            "--no-progress",
            "--config",
            str(ROOT / ".github" / "zizmor.yml"),
            "--min-confidence",
            "low",
            "--persona",
            "regular",
            target,
        ],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    print(f"Scan {target}: exit {result.returncode}")
    print(result.stdout + result.stderr)
    return result


def main() -> None:
    """Compare the old reproduction scope with CI's repository scope."""
    version = subprocess.run(
        ["zizmor", "--version"], capture_output=True, text=True, check=True
    )
    assert version.stdout.strip() == "zizmor 1.30.1", version.stdout
    with tempfile.TemporaryDirectory(prefix="zizmor-scope-") as directory:
        root = Path(directory)
        workflows = root / ".github" / "workflows"
        workflows.mkdir(parents=True)
        (workflows / "check.yml").write_text(WORKFLOW, encoding="utf-8")
        dependabot = root / ".github" / "dependabot.yml"
        dependabot.write_text(DEPENDABOT, encoding="utf-8")

        assert audit(root, ".github/workflows").returncode == 0
        missing_cooldown = audit(root, ".")
        assert missing_cooldown.returncode == 13
        assert "dependabot-cooldown" in missing_cooldown.stdout

        dependabot.write_text(
            DEPENDABOT + "    cooldown:\n      default-days: 7\n", encoding="utf-8"
        )
        assert audit(root, ".").returncode == 0


if __name__ == "__main__":
    main()
