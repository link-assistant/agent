#!/usr/bin/env python3
"""Replay the old tag gate and a delayed PyPI release without external writes.

Run from the repository root with Python 3.11+:
    python experiments/reproduce_partial_release.py

The legacy shell gate comes from the prepared branch's baseline commit. All Git
operations use one temporary repository, and propagation uses a virtual clock.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import check_release  # noqa: E402


def legacy_gate() -> str:
    """Extract the tag-based check from the unchanged baseline workflow."""
    workflow = subprocess.run(
        ["git", "show", "1e929ef:.github/workflows/release.yml"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
        timeout=15,
    ).stdout
    step = workflow.split("      - name: Check if version changed\n", 1)[1]
    body = step.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
    return (
        "\n".join(line[10:] for line in body.splitlines())
        .replace("${{ steps.python_layout.outputs.root }}", ".")
        .replace("${{ steps.python_layout.outputs.multi_language }}", "false")
    )


def main() -> None:
    """Compare the tag gate and new artifact gate, then simulate four-minute lag."""
    with tempfile.TemporaryDirectory(prefix="partial-release-replay-") as temporary:
        root = Path(temporary)
        (root / "scripts").mkdir()
        shutil.copy(
            ROOT / "scripts/read_manifest.py", root / "scripts/read_manifest.py"
        )
        (root / "pyproject.toml").write_text(
            '[project]\nname="demo-package"\nversion="1.2.3"\n'
        )
        for arguments in (
            ["git", "init", "-b", "main"],
            ["git", "add", "pyproject.toml"],
            [
                "git",
                "-c",
                "user.name=Replay",
                "-c",
                "user.email=replay@example.test",
                "commit",
                "-m",
                "baseline",
            ],
            ["git", "tag", "v1.2.3"],
        ):
            subprocess.run(
                arguments, cwd=root, capture_output=True, check=True, timeout=15
            )
        output = root / "outputs"
        subprocess.run(
            ["bash", "-e", "-c", legacy_gate()],
            cwd=root,
            env={**os.environ, "GITHUB_OUTPUT": str(output)},
            check=True,
            timeout=15,
        )
        assert "should_release=false" in output.read_text()
        print("Before: an existing tag suppresses recovery of a missing GitHub release")
        with (
            patch.object(check_release, "pypi_release_exists", return_value=True),
            patch.object(check_release, "github_release_exists", return_value=False),
        ):
            outputs = check_release.check_release(root, "owner/repo")
        assert outputs["should_release"] == "true"
        print(
            "After: the uploaded version is retained and the missing release is repaired"
        )

    elapsed = [0.0]

    def sleep(seconds: float) -> None:
        elapsed[0] += seconds

    def request(*args, **kwargs):
        return (200 if elapsed[0] >= 240 else 404), {}

    with (
        patch.object(check_release.time, "monotonic", side_effect=lambda: elapsed[0]),
        patch.object(check_release.time, "sleep", side_effect=sleep),
        patch.object(check_release, "request_json", side_effect=request),
    ):
        check_release.wait_for_pypi("demo-package", "1.2.3")
    assert elapsed[0] == 240
    print("After: the explicit wait survives 240 seconds of simulated propagation lag")


if __name__ == "__main__":
    main()
