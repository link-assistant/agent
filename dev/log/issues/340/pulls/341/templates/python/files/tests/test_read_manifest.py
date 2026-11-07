"""Tests for scripts/read_manifest.py (issue #67).

A grep-based scrape cannot see TOML tables, so the release step used to pick
up a ``version`` key from any table. These tests pin the table-path reader.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "read_manifest.py"
spec = importlib.util.spec_from_file_location("read_manifest", SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)  # type: ignore[union-attr]


def run_script(tmp_path: Path, manifest: str, *args: str) -> tuple[int, str, str]:
    manifest_path = tmp_path / "pyproject.toml"
    manifest_path.write_text(manifest)
    proc = subprocess.run(
        [sys.executable, str(SCRIPT_PATH), str(manifest_path), *args],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


def test_reads_project_version_even_when_other_tables_have_version_keys(
    tmp_path: Path,
) -> None:
    """The scriv-documented [tool.scriv] version must not shadow [project]."""
    manifest = """
[project]
name = "example"
version = "1.2.3"

[tool.scriv]
version = "scripted"
"""
    code, out, err = run_script(tmp_path, manifest)
    assert code == 0, err
    assert out == "1.2.3\n"


def test_missing_field_fails_loudly(tmp_path: Path) -> None:
    code, out, err = run_script(tmp_path, "[project]\nname = 'example'\n")
    assert code == 1
    assert out == ""
    assert "no field 'project.version'" in err


def test_non_string_field_fails_loudly(tmp_path: Path) -> None:
    code, out, err = run_script(tmp_path, "[project]\nversion = 3\n")
    assert code == 1
    assert "is not a string" in err


def test_output_flag_writes_github_output(tmp_path: Path) -> None:
    manifest = "[project]\nversion = '9.9.9'\n"
    manifest_path = tmp_path / "pyproject.toml"
    manifest_path.write_text(manifest)
    output_file = tmp_path / "github-output.txt"
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_PATH),
            str(manifest_path),
            "--output",
            "current_version",
        ],
        capture_output=True,
        text=True,
        env={"GITHUB_OUTPUT": str(output_file), "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0, proc.stderr
    assert output_file.read_text() == "current_version=9.9.9\n"
    assert proc.stdout == "9.9.9\n"
