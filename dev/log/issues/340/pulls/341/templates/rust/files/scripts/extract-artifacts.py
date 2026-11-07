#!/usr/bin/env python3
"""Extract verified download-artifact raw ZIPs without the Node ZIP adapter.

The download action owns SHA256 verification. This adapter validates every path
and member before writing, rejects symlinks/special files and refuses collisions.
Raw files from upload-artifact's archive:false mode are intentionally unsupported.
"""
import argparse
from pathlib import Path, PurePosixPath, PureWindowsPath
import shutil
import stat
import zipfile


def safe_destination(root, name):
    path = PurePosixPath(name)
    if (not name or '\\' in name or '\x00' in name or path.is_absolute()
            or PureWindowsPath(name).drive or '..' in path.parts):
        raise ValueError(f'Unsafe artifact member: {name!r}')
    destination = root.joinpath(*path.parts)
    # Reject existing symlinks even when they happen to point inside the root.
    for parent in (destination, *destination.parents):
        if parent.is_symlink():
            raise ValueError(f'Artifact destination contains a symlink: {parent}')
    if not destination.resolve().is_relative_to(root.resolve()):
        raise ValueError(f'Artifact member escapes destination: {name!r}')
    return destination


def extract_artifacts(raw, destination, merge_multiple=False):
    raw, destination = Path(raw), Path(destination).absolute()
    downloads = sorted(raw.iterdir())
    if not downloads:
        raise ValueError('No downloaded artifacts')
    plans = []
    seen = set()
    # v8 saves a named/single download directly, or multiple under artifact names.
    for download in downloads:
        if download.is_symlink():
            raise ValueError(f'Unexpected download symlink: {download}')
        archives = sorted(download.iterdir()) if download.is_dir() else [download]
        if len(archives) != 1 or not archives[0].is_file() or archives[0].is_symlink():
            raise ValueError(f'Expected one raw ZIP per artifact: {download}')
        output = destination / download.name if download.is_dir() and not merge_multiple else destination
        with zipfile.ZipFile(archives[0]) as archive:
            for member in archive.infolist():
                mode = member.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise ValueError(f'Unsupported artifact member type: {member.filename}')
                target = safe_destination(output, member.filename)
                key = str(target).casefold()
                if not member.is_dir() and (key in seen or target.exists()):
                    raise ValueError(f'Duplicate artifact destination: {target}')
                if not member.is_dir():
                    seen.add(key)
                plans.append((archives[0], member, target))
    # Stream bytes: ZIP payloads need not fit in memory; ZipFile checks CRCs.
    for archive_path, member, target in plans:
        if member.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive_path) as archive, archive.open(member) as source, target.open('xb') as sink:
            shutil.copyfileobj(source, sink, length=1024 * 1024)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raw', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--merge-multiple', action='store_true')
    args = parser.parse_args()
    extract_artifacts(args.raw, args.destination, args.merge_multiple)
