#!/usr/bin/env python3
"""Verify real uv lock refreshes alter only the local project version offline."""

import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path

uv = shutil.which("uv")
if not uv:
    raise SystemExit("Install uv before running this offline experiment")
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    manifest = root / "pyproject.toml"
    manifest.write_text(
        '[project]\nname = "Example_Project"\nversion = "1.0.0"\nrequires-python = ">=3.9"\n'
    )
    for version in ("1.0.0", "1.0.1"):
        manifest.write_text(manifest.read_text().replace("1.0.0", version))
        subprocess.run(
            [uv, "lock", "--offline", "--python", sys.executable], cwd=root, check=True
        )
        shutil.copy2(root / "uv.lock", root / f"{version}.lock")
    old = tomllib.loads((root / "1.0.0.lock").read_text())
    new = tomllib.loads((root / "1.0.1.lock").read_text())
    assert old["package"][0].pop("version") == "1.0.0"
    assert new["package"][0].pop("version") == "1.0.1"
    assert old == new
    print("Verified: real uv offline refresh preserves all non-version lock content")
