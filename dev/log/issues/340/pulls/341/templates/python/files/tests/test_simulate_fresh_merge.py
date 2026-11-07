"""Tests for the fresh-merge simulation used by pull-request CI."""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "simulate-fresh-merge.sh"

FAKE_GIT = """\
#!/usr/bin/env bash
attempts_file="$FAKE_GIT_STATE_DIR/fetch-attempts"
case "$1" in
  fetch)
    n=$(( $(cat "$attempts_file" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "$attempts_file"
    if [ "$n" -le "$FAIL_FIRST_FETCHES" ]; then
      echo "fatal: unable to access 'https://github.com/o/r/': Could not resolve host: github.com" >&2
      exit 128
    fi
    exit 0
    ;;
  config) exit 0 ;;
  rev-list) echo 0 ;;
  merge) exit 0 ;;
  *) exit 0 ;;
esac
"""


def run_script(
    fake_bin: Path, extra_env: dict[str, str]
) -> subprocess.CompletedProcess:
    """Run the script with a stand-in `git` first on PATH."""
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        **extra_env,
    }
    return subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def make_fake_git(tmp_path: Path, fail_first_fetches: int) -> Path:
    """Install a `git` that fails its first N fetches and delegates the rest."""
    fake_bin = tmp_path / "fakebin"
    fake_bin.mkdir(exist_ok=True)
    state_dir = tmp_path / "state"
    state_dir.mkdir(exist_ok=True)
    stub = fake_bin / "git"
    stub.write_text(FAKE_GIT, encoding="utf-8")
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
    return fake_bin


def test_fresh_merge_script_requires_base_ref() -> None:
    """The script should fail clearly instead of fetching an empty branch name."""
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "BASE_REF is required" in result.stderr


def test_transient_fetch_failure_recovers_within_the_retry_budget(
    tmp_path: Path,
) -> None:
    """One network blip must not fail the whole job (issue #70)."""
    fake_bin = make_fake_git(tmp_path, fail_first_fetches=1)
    result = run_script(
        fake_bin,
        {
            "BASE_REF": "main",
            "FAKE_GIT_STATE_DIR": str(tmp_path / "state"),
            "FAIL_FIRST_FETCHES": "1",
            "FRESH_MERGE_RETRY_DELAY_SECONDS": "0",
        },
    )

    assert result.returncode == 0, result.stderr
    assert "attempt 1 of 5" in result.stdout
    assert "Fetched origin/main on attempt 2 of 5" in result.stdout


def test_persistent_fetch_failure_fails_after_the_attempts_are_exhausted(
    tmp_path: Path,
) -> None:
    """A base branch that truly cannot be fetched must still fail."""
    fake_bin = make_fake_git(tmp_path, fail_first_fetches=99)
    result = run_script(
        fake_bin,
        {
            "BASE_REF": "main",
            "FAKE_GIT_STATE_DIR": str(tmp_path / "state"),
            "FAIL_FIRST_FETCHES": "99",
            "FRESH_MERGE_FETCH_ATTEMPTS": "3",
            "FRESH_MERGE_RETRY_DELAY_SECONDS": "0",
        },
    )

    assert result.returncode == 1
    assert "::error::Could not fetch origin/main after 3 attempts" in result.stderr
    assert "attempt 2 of 3" in result.stdout
    assert "attempt 3 of 3" not in result.stdout
    assert "attempt 4 of 3" not in result.stdout


def test_non_integer_retry_knobs_fail_with_a_usable_message(tmp_path: Path) -> None:
    """A misconfigured knob must not silently disable the retry."""
    fake_bin = make_fake_git(tmp_path, fail_first_fetches=0)
    result = run_script(
        fake_bin,
        {
            "BASE_REF": "main",
            "FAKE_GIT_STATE_DIR": str(tmp_path / "state"),
            "FAIL_FIRST_FETCHES": "0",
            "FRESH_MERGE_RETRY_DELAY_SECONDS": "1.5",
        },
    )

    assert result.returncode == 2
    assert (
        "FRESH_MERGE_RETRY_DELAY_SECONDS must be a non-negative integer"
        in result.stderr
    )
