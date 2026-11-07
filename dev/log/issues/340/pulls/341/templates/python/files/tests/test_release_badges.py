"""Badge detection must compare parsed URL hosts, not arbitrary note substrings."""

import pytest

from scripts.create_github_release import append_pypi_badge_if_missing
from scripts.format_release_notes import format_release_body
from scripts.release_naming import build_pypi_badge


@pytest.mark.parametrize(
    "example",
    [
        "https://img.shields.io.attacker.invalid/badge/example",
        "https://attacker.invalid/img.shields.io/badge/example",
        "https://img.shields.io@attacker.invalid/badge/example",
        "https://attacker.invalid/?next=https://img.shields.io/badge/example",
        "The badge provider is img.shields.io.",
        "https://pypi.org.attacker.invalid/project/example/",
        "https://attacker.invalid/pypi.org/project/example/",
    ],
)
def test_unrelated_urls_and_prose_do_not_suppress_the_release_badge(example):
    body = f"Release details: {example}"
    badge = build_pypi_badge("example", "1.2.3")
    assert append_pypi_badge_if_missing(body, "example", "1.2.3").endswith(badge)
    assert format_release_body(body, "1.2.3", "owner/repo", None, "example").startswith(
        badge
    )


@pytest.mark.parametrize("scheme", ["https", "http"])
def test_real_badge_hosts_remain_idempotent(scheme):
    body = f"![badge]({scheme}://IMG.SHIELDS.IO/badge/pypi-1.2.3-blue.svg)"
    assert append_pypi_badge_if_missing(body, "example", "1.2.3") == body
    assert format_release_body(body, "1.2.3", "owner/repo", None, "example") == body


def test_formatter_preserves_existing_pypi_project_link_behavior():
    body = "[PyPI](https://pypi.org/project/example/1.2.3/)"
    assert format_release_body(body, "1.2.3", "owner/repo", None, "example") == body
