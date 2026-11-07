#!/usr/bin/env python3
"""Offline CLI regressions: missing Git evidence must not become no-change outputs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/detect-code-changes.rs'


class GitEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = shutil.which('rust-script')
        cls.git = shutil.which('git')
        if not cls.runner or not cls.git:
            raise RuntimeError('rust-script and git are required')
        # Complete compilation before the per-probe deadlines start.
        subprocess.run([cls.runner, '--wrapper', 'true', str(SCRIPT)], cwd=ROOT,
                       env={**os.environ, 'RUST_LOG': 'error'}, check=True)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='issue-228-git-')
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('GITHUB_')}
        self.output = self.work / 'outputs'
        self.env.update(RUST_LOG='error', GITHUB_EVENT_NAME='push', GITHUB_OUTPUT=str(self.output))
        self.command([self.git, 'init', '-q', '-b', 'main'], check=True)
        for key, value in [('user.name', 'Test'), ('user.email', 'test@example.invalid')]:
            self.command([self.git, 'config', key, value], check=True)
        (self.work / 'src').mkdir()
        (self.work / 'src/lib.rs').write_text('pub fn fixture() {}\n')
        (self.work / 'Cargo.toml').write_text('[package]\nname="fixture"\nversion="1.0.0"\n')
        self.command([self.git, 'add', '.'], check=True)
        self.command([self.git, 'commit', '-qm', 'initial'], check=True)

    def command(self, args, **options):
        return subprocess.run(args, cwd=self.work, env=self.env, capture_output=True,
                              text=True, timeout=30, **options)

    def run_detector(self):
        return self.command([self.runner, str(SCRIPT)])

    def assert_no_claim(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('-changed=', result.stdout)
        self.assertFalse(self.output.exists(), result.stdout + result.stderr)

    def test_missing_checkout(self):
        shutil.rmtree(self.work / '.git')
        self.assert_no_claim(self.run_detector())

    def test_corrupt_head(self):
        (self.work / '.git/HEAD').write_text('invalid HEAD\n')
        self.assert_no_claim(self.run_detector())

    def mock_git(self, failed_command):
        tools = self.work / 'tools'
        tools.mkdir(exist_ok=True)
        shim = tools / 'git'
        shim.write_text('''#!/usr/bin/env python3
import os, sys
if os.environ['FAIL_GIT'] in ('all', sys.argv[1]):
    sys.stderr.write('injected Git evidence failure\\n')
    sys.exit(42)
os.execv(os.environ['REAL_GIT'], [os.environ['REAL_GIT'], *sys.argv[1:]])
''')
        shim.chmod(0o755)
        self.env.update(FAIL_GIT=failed_command, REAL_GIT=self.git,
                        PATH=str(tools) + os.pathsep + os.environ['PATH'])

    def test_initial_commit_and_successful_empty_diff_are_distinct(self):
        result = self.run_detector()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('rs-changed=true', self.output.read_text())
        self.output.unlink()
        self.command([self.git, 'commit', '--allow-empty', '-qm', 'empty'], check=True)
        result = self.run_detector()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.output.read_text().splitlines()), 5)
        self.assertTrue(all(line.endswith('=false') for line in self.output.read_text().splitlines()))
        self.assertNotIn('listing all files', result.stdout)

    def test_failed_git_evidence_is_fatal(self):
        for operation in ['all', 'rev-parse', 'cat-file', 'ls-tree']:
            with self.subTest(operation=operation):
                self.mock_git(operation)
                result = self.run_detector()
                self.assert_no_claim(result)
                self.assertIn('injected Git evidence failure', result.stderr)
        self.command([self.git, 'commit', '--allow-empty', '-qm', 'empty'], check=True)
        self.mock_git('diff')
        result = self.run_detector()
        self.assert_no_claim(result)
        self.assertIn('injected Git evidence failure', result.stderr)

    def test_pr_diff_failure_does_not_fall_back_to_base_diff(self):
        self.command([self.git, 'checkout', '-qb', 'feature'], check=True)
        (self.work / 'src/lib.rs').write_text('pub fn changed() {}\n')
        self.command([self.git, 'commit', '-qam', 'feature change'], check=True)
        self.command([self.git, 'checkout', '-q', 'main'], check=True)
        self.command([self.git, 'merge', '--no-ff', '-qm', 'synthetic merge', 'feature'], check=True)
        self.env['GITHUB_EVENT_NAME'] = 'pull_request'
        self.mock_git('diff')
        result = self.run_detector()
        self.assert_no_claim(result)
        self.assertIn('injected Git evidence failure', result.stderr)

    def test_output_write_failure_remains_fatal(self):
        self.env['GITHUB_OUTPUT'] = str(self.work)
        result = self.run_detector()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('GITHUB_OUTPUT', result.stderr)


if __name__ == '__main__':
    unittest.main()
