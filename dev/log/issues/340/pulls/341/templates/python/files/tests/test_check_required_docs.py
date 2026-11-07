"""Tests for scripts/check-required-docs.sh (issue #72)."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "scripts" / "check-required-docs.sh"


def run_script(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(SCRIPT_PATH), *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )


def test_real_repository_passes() -> None:
    """The template itself must satisfy its own documentation contract."""
    result = run_script(cwd=ROOT)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "All required documentation is present" in result.stdout


def test_list_prints_the_requirement_table() -> None:
    """--list prints `path<TAB>section` rows built from the same table."""
    result = run_script("--list", cwd=ROOT)
    assert result.returncode == 0
    assert "README.md\tFeatures" in result.stdout
    assert "CONTRIBUTING.md\tChangelog Management" in result.stdout
    assert "CHANGELOG.md\n" in result.stdout


def test_missing_section_fails_with_annotation(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("## Features\n")
    result = run_script(cwd=tmp_path)
    assert result.returncode == 1
    assert "missing required section '## Quick Start'" in result.stdout
    assert "::error title=Documentation validation failed::" in result.stdout


def test_missing_file_fails_without_requiring_sections(tmp_path: Path) -> None:
    result = run_script(cwd=tmp_path)
    assert result.returncode == 1
    assert "README.md: file is missing" in result.stdout
    assert "CHANGELOG.md: file is missing" in result.stdout


def test_unknown_argument_is_a_usage_error(tmp_path: Path) -> None:
    result = run_script("--wat", cwd=tmp_path)
    assert result.returncode == 2
    assert "usage:" in result.stderr
