#!/usr/bin/env python3
"""Read one field from a TOML manifest by its table path.

A grep-based scrape cannot see TOML tables, so a ``version`` key outside the
``[project]`` table -- scriv's documented ``[tool.scriv] version``, for
example -- turns a line-anchored match into a multi-line value and breaks the
release step that writes it into ``$GITHUB_OUTPUT`` (issue #67). Parse the
document and address the field by its path instead: a missing field fails
loudly rather than releasing under an empty tag.

Usage:
    python scripts/read_manifest.py pyproject.toml --field project.version
    python scripts/read_manifest.py pyproject.toml --output current_version

The value is always printed on stdout. With ``--output NAME`` it is also
written to the GitHub Actions output file as ``NAME=<value>``.
"""

from __future__ import annotations

import argparse
import os
import sys
import tomllib
from pathlib import Path


def read_field(document: dict[str, object], field: str) -> str:
    """Resolve a dotted table path in a parsed TOML document."""
    value: object = document
    for part in field.split("."):
        if not isinstance(value, dict) or part not in value:
            msg = f"manifest has no field '{field}' (stopped at '{part}')"
            raise KeyError(msg)
        value = value[part]
    if not isinstance(value, str):
        msg = f"manifest field '{field}' is not a string: {value!r}"
        raise ValueError(msg)
    return value


def main() -> int:
    """Print the requested manifest field, optionally as a workflow output."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="path to the TOML manifest")
    parser.add_argument(
        "--field",
        default="project.version",
        help="dotted table path of the field to read",
    )
    parser.add_argument(
        "--output",
        help="also write NAME=<value> to $GITHUB_OUTPUT",
    )
    args = parser.parse_args()

    try:
        with args.manifest.open("rb") as handle:
            document = tomllib.load(handle)
        value = read_field(document, args.field)
    except (OSError, tomllib.TOMLDecodeError, KeyError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    if args.output:
        output_file = os.environ.get("GITHUB_OUTPUT")
        if output_file:
            with Path(output_file).open("a", encoding="utf-8") as stream:
                stream.write(f"{args.output}={value}\n")

    print(value)
    return 0


if __name__ == "__main__":
    sys.exit(main())
