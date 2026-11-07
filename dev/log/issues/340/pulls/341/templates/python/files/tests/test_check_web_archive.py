"""Tests for the broken-link Web Archive fallback helper."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent / "scripts" / "check_web_archive.py"
)
spec = importlib.util.spec_from_file_location("check_web_archive", SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)  # type: ignore[union-attr]


def test_extract_broken_urls_supports_lychee_markdown_and_deduplicates() -> None:
    """Every broken URL format emitted by lychee should be recognized once."""
    report = """
* [404] https://example.com/missing
- [ERROR] https://example.org/offline | connection refused
* Failure at <https://example.net/timeout>
* [500] https://example.com/missing
"""

    assert module.extract_broken_urls(report) == [
        "https://example.com/missing",
        "https://example.org/offline",
        "https://example.net/timeout",
    ]


def test_check_wayback_machine_returns_available_https_snapshot(monkeypatch) -> None:
    """An available snapshot should be normalized to an HTTPS archive URL."""
    payload = {
        "archived_snapshots": {
            "closest": {
                "available": True,
                "url": "http://web.archive.org/web/20240102030405/https://example.com",
                "timestamp": "20240102030405",
            }
        }
    }
    monkeypatch.setattr(module, "fetch_json", lambda _url: payload)

    result = module.check_wayback_machine("https://example.com")

    assert result.available is True
    assert result.archive_url.startswith("https://web.archive.org/")
    assert result.timestamp == "20240102030405"


def test_check_wayback_machine_treats_api_errors_as_unavailable(monkeypatch) -> None:
    """A Wayback outage must not incorrectly approve a broken documentation URL."""

    def fail(_url: str) -> dict[str, object]:
        raise OSError("temporary outage")

    monkeypatch.setattr(module, "fetch_json", fail)

    result = module.check_wayback_machine("https://example.com")

    assert result.available is False
    assert result.archive_url is None
    assert result.timestamp is None


def test_split_recovered_urls_drops_recovered_urls_from_the_archive_lookup() -> None:
    """A URL the re-check found healthy must not reach the Wayback Machine."""
    remaining, recovered = module.split_recovered_urls(
        ["https://a.example/x", "https://b.example/y"], "https://b.example/y\n"
    )

    assert remaining == ["https://a.example/x"]
    assert recovered == ["https://b.example/y"]


def test_split_recovered_urls_skips_nothing_when_the_file_is_missing_or_empty() -> None:
    urls = ["https://a.example/x"]

    assert module.split_recovered_urls(urls, "") == (urls, [])
    assert module.split_recovered_urls(urls, None) == (urls, [])


def test_main_treats_a_recheck_recovered_url_as_not_broken(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    """The archive pass must pass cleanly when the re-check recovered every URL."""
    report = tmp_path / "out.md"
    report.write_text(
        "- [ERROR] <https://recovered.example/reset> | Connection reset by peer\n",
        encoding="utf-8",
    )
    recovered = tmp_path / "recovered.txt"
    recovered.write_text("https://recovered.example/reset\n", encoding="utf-8")
    monkeypatch.setenv("LYCHEE_OUTPUT", str(report))
    monkeypatch.setenv("RECOVERED_URLS", str(recovered))
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)

    def explode(url: str) -> dict[str, object]:
        raise AssertionError(f"healthy URL {url} must not reach the Wayback Machine")

    monkeypatch.setattr(module, "fetch_json", explode)

    assert module.main() == 0
    output = capsys.readouterr().out
    assert "answers the re-check -- not broken" in output
    assert "No broken URLs found in lychee output." in output


@pytest.mark.parametrize(
    "report_kind", ["missing", "empty", "malformed", "directory", "invalid-utf8"]
)
def test_failed_checker_requires_readable_report(
    tmp_path: Path, report_kind: str
) -> None:
    """A failed lychee cannot be approved without readable failure evidence."""
    report = tmp_path / "out.md"
    if report_kind == "directory":
        report.mkdir()
    elif report_kind != "missing":
        report.write_bytes(
            {"empty": b"", "malformed": b"checker crashed", "invalid-utf8": b"\xff"}[
                report_kind
            ]
        )
    outputs = tmp_path / "outputs"
    result = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        env={
            **os.environ,
            "LYCHEE_OUTPUT": str(report),
            "LYCHEE_EXIT_CODE": "2",
            "GITHUB_OUTPUT": str(outputs),
        },
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    assert result.returncode != 0
    assert "all_archived=true" not in result.stdout
    assert "all_archived=false" in outputs.read_text()
    assert "::error::" in result.stdout
