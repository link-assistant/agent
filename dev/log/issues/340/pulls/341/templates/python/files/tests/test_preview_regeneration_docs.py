"""Tests for preview-regeneration parity documentation."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def read_text(relative_path: str) -> str:
    """Read a repository file as text."""
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_preview_regeneration_parity_is_documented() -> None:
    """Issue #9 should remain tracked until a browser app surface exists."""
    page = read_text("docs/preview-regeneration.md")

    assert "python-ai-driven-development-pipeline-template/issues/9" in page
    assert "js-ai-driven-development-pipeline-template/issues/62" in page
    assert "playwright-python" in page
    assert "browser-commander" in page
    assert "does not ship a browser-rendered example app" in page
    assert "locale x theme" in page


def test_preview_regeneration_docs_are_discoverable() -> None:
    """The tracking page should be reachable from docs and README."""
    assert "preview-regeneration" in read_text("docs/index.md")
    assert "docs/preview-regeneration.md" in read_text("README.md")
