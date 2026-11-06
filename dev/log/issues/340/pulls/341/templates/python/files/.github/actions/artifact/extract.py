#!/usr/bin/env python3
"""Extract artifact ZIPs only after validating every destination and entry type."""

from __future__ import annotations

import re
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


def extract_archive(archive: Path, destination: Path) -> None:
    """Reject traversal, symlinks, special files and collisions before writing."""
    if destination.is_symlink():
        msg = "Artifact destination is a symlink"
        raise ValueError(msg)
    root = destination.resolve()
    with zipfile.ZipFile(archive) as stream:
        entries = []
        seen: set[Path] = set()
        for info in stream.infolist():
            name = info.filename
            parts = PurePosixPath(name).parts
            mode = stat.S_IFMT(info.external_attr >> 16)
            if (
                not parts
                or name.startswith("/")
                or "\\" in name
                or ".." in parts
                or re.match(r"^[A-Za-z]:", name)
                or mode not in (0, stat.S_IFREG, stat.S_IFDIR)
            ):
                msg = f"Unsafe artifact ZIP entry: {name!r}"
                raise ValueError(msg)
            target = root.joinpath(*parts)
            if target in seen or (
                target.exists() and not (info.is_dir() and target.is_dir())
            ):
                msg = f"Duplicate or existing artifact destination: {name!r}"
                raise ValueError(msg)
            seen.add(target)
            for ancestor in (target, *target.parents):
                if ancestor == root:
                    break
                if ancestor.is_symlink() or (
                    ancestor.exists() and ancestor != target and not ancestor.is_dir()
                ):
                    msg = f"Unsafe artifact destination: {name!r}"
                    raise ValueError(msg)
            entries.append((info, target))
        if not entries:
            msg = "Empty artifact ZIP"
            raise ValueError(msg)
        # Detect file/directory conflicts anywhere in the ZIP before extracting.
        files = {target for info, target in entries if not info.is_dir()}
        if any(parent in files for _, target in entries for parent in target.parents):
            msg = "Conflicting artifact ZIP paths"
            raise ValueError(msg)
        for info, target in entries:
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with stream.open(info) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)


if __name__ == "__main__":
    try:
        extract_archive(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Artifact extraction failed: {error}", file=sys.stderr)
        sys.exit(1)
