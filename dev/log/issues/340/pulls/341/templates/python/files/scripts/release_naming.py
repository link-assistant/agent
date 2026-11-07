"""Layout-aware release naming helpers for the Python package."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union
from urllib.parse import quote, urlsplit


LANGUAGE = "Python"
MULTI_LANGUAGE_TAG_PREFIX = "py_v"
SINGLE_LANGUAGE_TAG_PREFIX = "v"
PYPROJECT_FILE = "pyproject.toml"
PYTHON_SUBDIRECTORY = "python"


@dataclass(frozen=True)
class PythonLayout:
    """Detected Python package layout inside a repository."""

    root: Path
    multi_language: bool


def detect_python_layout(
    repository_root: Optional[Union[str, Path]] = None,
) -> PythonLayout:
    """Detect whether Python files live at the repo root or under python/."""
    root = Path.cwd() if repository_root is None else Path(repository_root)

    if (root / PYPROJECT_FILE).is_file():
        return PythonLayout(root=root, multi_language=False)

    python_root = root / PYTHON_SUBDIRECTORY
    if (python_root / PYPROJECT_FILE).is_file():
        return PythonLayout(root=python_root, multi_language=True)

    msg = (
        f"Could not find {PYPROJECT_FILE} at {root / PYPROJECT_FILE} "
        f"or {python_root / PYPROJECT_FILE}"
    )
    raise FileNotFoundError(msg)


def normalize_version(version: str) -> str:
    """Strip leading tag prefixes such as v, py_v, py-v, js_v, or rust_v."""
    if not version:
        return ""

    normalized = re.sub(r"^[A-Za-z]+[-_]v?", "", str(version).strip(), count=1)
    return re.sub(r"^v", "", normalized, count=1)


def get_tag_prefix(multi_language: bool) -> str:
    """Return the release tag prefix for the detected layout."""
    if multi_language:
        return MULTI_LANGUAGE_TAG_PREFIX
    return SINGLE_LANGUAGE_TAG_PREFIX


def build_release_tag(version: str, multi_language: bool) -> str:
    """Build an idempotent release tag for the detected layout."""
    return f"{get_tag_prefix(multi_language)}{normalize_version(version)}"


def build_release_title(
    version: str,
    distribution_name: str,
    multi_language: bool,
) -> str:
    """Build the GitHub release title for the detected layout."""
    bare_version = normalize_version(version)
    if multi_language:
        return f"[{LANGUAGE}] {bare_version}"
    return f"{distribution_name} {bare_version}"


def build_pypi_badge(distribution_name: str, version: str) -> str:
    """Build a shields.io PyPI badge linked to the exact version page."""
    bare_version = normalize_version(version)
    badge_version = quote(bare_version, safe="")
    package_path = quote(distribution_name, safe="")
    version_path = quote(bare_version, safe="")
    image_url = f"https://img.shields.io/badge/pypi-{badge_version}-blue.svg?logo=pypi"
    package_url = f"https://pypi.org/project/{package_path}/{version_path}/"
    return f"[![PyPI version]({image_url})]({package_url})"


def has_release_badge(body: str, *, include_project_link: bool = False) -> bool:
    """Recognize badge/project URLs by exact host, preserving formatting retries."""
    for candidate in re.findall(r"https?://[^\s<>()\[\]\"']+", body, re.IGNORECASE):
        try:
            url = urlsplit(candidate)
            if url.hostname == "img.shields.io" or (
                include_project_link
                and url.hostname == "pypi.org"
                and url.path.startswith("/project/")
            ):
                return True
        except ValueError:
            # Malformed example URLs do not prove the notes contain a badge.
            continue
    return False
