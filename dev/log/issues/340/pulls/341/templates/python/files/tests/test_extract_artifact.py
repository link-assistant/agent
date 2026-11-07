"""Validate downloaded ZIPs before extracting any content."""

from __future__ import annotations

import stat
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / ".github/actions/artifact/extract.py"


def extract(archive, destination):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(archive), str(destination)],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )


def test_preserves_nested_empty_and_binary_files(tmp_path):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as stream:
        stream.writestr("nested/", b"")
        stream.writestr("nested/data.bin", b"\x00\xff\x42")
        stream.writestr("empty", b"")
    destination = tmp_path / "output"
    result = extract(archive, destination)
    assert result.returncode == 0, result.stderr
    assert (destination / "nested/data.bin").read_bytes() == b"\x00\xff\x42"
    assert (destination / "empty").read_bytes() == b""


@pytest.mark.parametrize(
    "name",
    [
        "../escape",
        "/absolute",
        "nested/../../escape",
        "C:/escape",
        "..\\escape",
        "nested\\escape",
    ],
)
def test_rejects_unsafe_paths_before_writing_any_file(tmp_path, name):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as stream:
        stream.writestr("innocent", b"must not be extracted")
        stream.writestr(name, b"malicious")
    destination = tmp_path / "output"
    assert extract(archive, destination).returncode != 0
    assert not (destination / "innocent").exists()
    assert not (tmp_path / "escape").exists()


@pytest.mark.parametrize("mode", [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR])
def test_rejects_symlinks_and_special_files(tmp_path, mode):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as stream:
        info = zipfile.ZipInfo("link")
        info.create_system = 3
        info.external_attr = (mode | 0o777) << 16
        stream.writestr(info, "../outside")
    assert extract(archive, tmp_path / "output").returncode != 0


def test_rejects_existing_destination_symlinks(tmp_path):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as stream:
        stream.writestr("nested/file", b"data")
    destination = tmp_path / "output"
    destination.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (destination / "nested").symlink_to(outside, target_is_directory=True)
    assert extract(archive, destination).returncode != 0
    assert not (outside / "file").exists()


def test_rejects_corrupt_archive(tmp_path):
    archive = tmp_path / "bad.zip"
    archive.write_bytes(b"not a zip")
    assert extract(archive, tmp_path / "output").returncode != 0
