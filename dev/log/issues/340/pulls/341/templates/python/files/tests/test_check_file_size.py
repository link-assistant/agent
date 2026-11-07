"""Tests for scripts/check_file_size.py."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "check_file_size.py"
spec = importlib.util.spec_from_file_location("check_file_size", SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)  # type: ignore[union-attr]


def write_python_file_with_lines(path: Path, line_count: int) -> None:
    """Write a Python file with exactly the requested line count."""
    path.write_text(
        "\n".join(f"# line {line}" for line in range(1, line_count + 1)),
        encoding="utf-8",
    )


def test_classifies_warning_band_without_blocking() -> None:
    """Files above WARN_LINES but at or below MAX_LINES should only warn."""
    assert module.classify_line_count(module.WARN_LINES) == module.LineStatus.OK
    assert (
        module.classify_line_count(module.WARN_LINES + 1) == module.LineStatus.WARNING
    )
    assert module.classify_line_count(module.MAX_LINES) == module.LineStatus.WARNING


def test_classifies_hard_limit_violations() -> None:
    """Files above MAX_LINES should remain hard failures."""
    assert (
        module.classify_line_count(module.MAX_LINES + 1) == module.LineStatus.VIOLATION
    )


def test_markdown_files_get_their_own_budget() -> None:
    """Prose budgets are larger than code budgets but still bounded."""
    assert module.LIMITS[".md"] == (module.MAX_DOC_LINES, module.WARN_DOC_LINES)
    assert module.MAX_DOC_LINES > module.MAX_LINES
    assert (
        module.classify_line_count(
            module.MAX_LINES + 1,
            max_lines=module.MAX_DOC_LINES,
            warn_lines=module.WARN_DOC_LINES,
        )
        == module.LineStatus.OK
    )
    assert (
        module.classify_line_count(
            module.MAX_DOC_LINES + 1,
            max_lines=module.MAX_DOC_LINES,
            warn_lines=module.WARN_DOC_LINES,
        )
        == module.LineStatus.VIOLATION
    )


def test_check_directory_applies_markdown_budget(tmp_path) -> None:
    """A markdown file over the code limit stays OK; over the doc limit fails."""

    def write_lines(path: Path, line_count: int) -> None:
        path.write_text(
            "\n".join(f"line {line}" for line in range(1, line_count + 1)),
            encoding="utf-8",
        )

    write_lines(tmp_path / "prose.md", module.MAX_LINES + 1)
    write_lines(tmp_path / "huge.md", module.MAX_DOC_LINES + 1)

    result = module.check_directory(tmp_path)

    assert result.violations == [
        module.Finding(
            file=Path("huge.md"),
            lines=module.MAX_DOC_LINES + 1,
            max_lines=module.MAX_DOC_LINES,
            warn_lines=module.WARN_DOC_LINES,
        )
    ]
    assert result.warnings == []


def test_check_directory_reports_warning_and_violation_separately(tmp_path) -> None:
    """Near-limit files should not be mixed with hard-limit failures."""
    source_dir = tmp_path / "src"
    source_dir.mkdir()
    write_python_file_with_lines(source_dir / "near_limit.py", module.WARN_LINES + 1)
    write_python_file_with_lines(source_dir / "over_limit.py", module.MAX_LINES + 1)
    write_python_file_with_lines(source_dir / "small.py", module.WARN_LINES)

    result = module.check_directory(tmp_path)

    assert result.warnings == [
        module.Finding(file=Path("src/near_limit.py"), lines=module.WARN_LINES + 1)
    ]
    assert result.violations == [
        module.Finding(file=Path("src/over_limit.py"), lines=module.MAX_LINES + 1)
    ]


def test_warning_annotation_uses_github_actions_format() -> None:
    """Near-limit files should produce a GitHub Actions warning annotation."""
    finding = module.Finding(
        file=Path("src/near_limit.py"),
        lines=module.WARN_LINES + 1,
    )

    assert module.warning_annotation(finding) == (
        "::warning file=src/near_limit.py::File has 901 lines "
        "(approaching limit of 1000). Consider extracting content to keep at or "
        "below 900 lines and prevent concurrent PR merge limit violations."
    )


def test_main_emits_warning_annotation_without_failing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Warning-only files should annotate but keep the script successful."""
    write_python_file_with_lines(tmp_path / "near_limit.py", module.WARN_LINES + 1)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(SystemExit) as exc_info:
        module.main()

    assert exc_info.value.code == 0
    output = capsys.readouterr()
    assert "::warning file=near_limit.py::File has 901 lines" in output.out
    assert "WARNING: near_limit.py has 901 lines" in output.out
    assert output.err == ""


def test_main_keeps_hard_limit_violations_failing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Files over MAX_LINES should still fail the script."""
    write_python_file_with_lines(tmp_path / "over_limit.py", module.MAX_LINES + 1)
    monkeypatch.chdir(tmp_path)

    with pytest.raises(SystemExit) as exc_info:
        module.main()

    assert exc_info.value.code == 1
    output = capsys.readouterr()
    assert "over_limit.py: 1001 lines (exceeds 1000)" in output.out
    assert output.err == ""
