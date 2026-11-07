#!/usr/bin/env python3
"""Bounded offline fixtures for the explicit Python ZIP extraction adapter."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class ArtifactExtraction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('extract', ROOT / 'scripts/extract-artifacts.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='issue-223-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.raw = self.root / 'raw'
        self.raw.mkdir()
        self.dest = self.root / 'out'

    def archive(self, name='artifact', entries=None):
        file = self.raw / name
        file.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(file, 'w') as archive:
            for member, data in entries or [('nested/check.bin', bytes(range(256)))]:
                archive.writestr(member, data)

    def test_named_and_single_pattern_preserve_bytes(self):
        self.archive()
        self.module.extract_artifacts(self.raw, self.dest, False)
        self.assertEqual((self.dest / 'nested/check.bin').read_bytes(), bytes(range(256)))

    def test_multiple_layout_and_merge(self):
        self.archive('one/artifact', [('a.txt', b'one')])
        self.archive('two/artifact', [('b.txt', b'two')])
        self.module.extract_artifacts(self.raw, self.dest, False)
        self.assertEqual((self.dest / 'one/a.txt').read_bytes(), b'one')
        self.assertEqual((self.dest / 'two/b.txt').read_bytes(), b'two')
        merged = self.root / 'merged'
        self.module.extract_artifacts(self.raw, merged, True)
        self.assertEqual((merged / 'a.txt').read_bytes(), b'one')
        self.assertEqual((merged / 'b.txt').read_bytes(), b'two')

    def test_rejects_traversal_absolute_windows_symlink_and_special_members(self):
        for name in ['../outside', '/absolute', 'C:/drive', 'a\\..\\escape', 'a/../../escape']:
            with self.subTest(name=name):
                self.archive(entries=[('safe.txt', b'safe'), (name, b'bad')])
                with self.assertRaises(ValueError):
                    self.module.extract_artifacts(self.raw, self.dest, False)
                self.assertFalse((self.dest / 'safe.txt').exists(), 'validate all members before writing')
        for mode in [stat.S_IFLNK, stat.S_IFIFO]:
            member = zipfile.ZipInfo('special')
            member.create_system = 3
            member.external_attr = (mode | 0o777) << 16
            self.archive(entries=[(member, 'outside')])
            with self.assertRaises(ValueError):
                self.module.extract_artifacts(self.raw, self.dest, False)

    def test_existing_symlink_and_duplicate_destinations_fail(self):
        outside = self.root / 'outside'
        outside.mkdir()
        self.dest.mkdir()
        (self.dest / 'nested').symlink_to(outside, target_is_directory=True)
        self.archive()
        with self.assertRaises(ValueError):
            self.module.extract_artifacts(self.raw, self.dest, False)
        self.assertFalse((outside / 'check.bin').exists())
        (self.dest / 'nested').unlink()
        with self.assertWarnsRegex(UserWarning, 'Duplicate name'):
            self.archive(entries=[('a', b'1'), ('a', b'2')])
        with self.assertRaises(ValueError):
            self.module.extract_artifacts(self.raw, self.dest, False)

    def test_missing_corrupt_and_empty_downloads_fail(self):
        with self.assertRaises(ValueError):
            self.module.extract_artifacts(self.raw, self.dest, False)
        (self.raw / 'artifact').write_bytes(b'not a zip')
        with self.assertRaises(zipfile.BadZipFile):
            self.module.extract_artifacts(self.raw, self.dest, False)


if __name__ == '__main__':
    unittest.main()
