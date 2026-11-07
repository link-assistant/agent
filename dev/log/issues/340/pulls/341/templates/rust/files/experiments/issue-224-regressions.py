#!/usr/bin/env python3
"""Offline publication CLI regressions. Only a local gh stub receives requests."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rust_script = shutil.which('rust-script')
        for script in ['create-github-release.rs']:
            result = subprocess.run([cls.rust_script, '--wrapper', 'true', str(ROOT / 'scripts' / script)],
                                    capture_output=True, text=True, env={**os.environ, 'RUST_LOG': 'error'})
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='issue-224-release-')
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        (self.work / 'Cargo.toml').write_text('[package]\nname="fixture"\nversion="1.2.3"\n')
        (self.work / 'src').mkdir()
        (self.work / 'src/lib.rs').write_text('pub fn fixture() {}\n')
        (self.work / 'bin').mkdir()
        gh = self.work / 'bin/gh'
        gh.write_text('#!/bin/sh\ncat > "$PAYLOAD_FILE"\nprintf "{}"\n')
        gh.chmod(0o755)
        self.env = {**os.environ, 'RUST_LOG': 'error', 'PAYLOAD_FILE': str(self.work / 'payload.json'),
                    'PATH': str(gh.parent) + os.pathsep + os.environ['PATH']}

    def release(self, content, version='1.2.3'):
        (self.work / 'CHANGELOG.md').write_bytes(content.encode())
        return subprocess.run([self.rust_script, str(ROOT / 'scripts/create-github-release.rs'),
                               '--release-version', version, '--repository', 'fixture/repo'],
                              cwd=self.work, env=self.env, capture_output=True, text=True, timeout=30)

    def test_fenced_examples_and_remaining_details_are_published_intact(self):
        for delimiter in ['```', '~~~~']:
            body = f'\r\nExample:\r\n{delimiter}md\r\n## [9.9.9]\r\n{delimiter}\r\n\r\n### Fixed\r\n  Remaining details.\r\n\r\n'
            result = self.release(f'## [1.2.3]\r\n{body}## [1.2.2]\r\nold')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            notes = json.loads((self.work / 'payload.json').read_text())['body']
            self.assertIn(body, notes)
            self.assertNotIn('\nold', notes)

    def test_version_only_inside_fence_and_missing_changelog_never_publish(self):
        result = self.release('## [1.2.2]\n```md\n## [1.2.3]\nexample\n```\n')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.work / 'payload.json').exists())
        (self.work / 'CHANGELOG.md').unlink()
        for unreadable in [False, True]:
            with self.subTest(unreadable=unreadable):
                if unreadable:
                    (self.work / 'CHANGELOG.md').mkdir()
                result = subprocess.run([self.rust_script, str(ROOT / 'scripts/create-github-release.rs'),
                                         '--release-version', '1.2.3', '--repository', 'fixture/repo'],
                                        cwd=self.work, env=self.env, capture_output=True, text=True, timeout=30)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('Cannot read required changelog', result.stderr)
                self.assertFalse((self.work / 'payload.json').exists())


if __name__ == '__main__':
    unittest.main()
