"""Sphinx configuration for the python-ai-driven-development-pipeline-template docs.

Edit ``project``, ``author``, and the autodoc target package when bootstrapping
a new repository from this template.
"""

from __future__ import annotations

import sys
from importlib import metadata
from pathlib import Path

# Make ``src/`` importable so autodoc can introspect the package.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

project = "my-package"
author = "Your Name"

try:
    release = metadata.version("my-package")
except metadata.PackageNotFoundError:
    release = "0.0.0"
version = release

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx.ext.intersphinx",
    "myst_parser",
]

autosummary_generate = True
autodoc_typehints = "description"
autodoc_default_options = {
    "members": True,
    "undoc-members": False,
    "show-inheritance": True,
}
napoleon_google_docstring = True
napoleon_numpy_docstring = False

intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
}

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "furo"
html_static_path: list[str] = []
html_title = f"{project} {release}"
