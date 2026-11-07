#!/usr/bin/env python3
"""Run release helpers in isolated fixtures; never publish or contact a registry.

Run with python3 experiments/issue-192-release-io-regressions.py -v.
Compile before bounded probes so build time does not consume test deadlines.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = (
    "get-version.rs", "get-bump-type.rs", "detect-code-changes.rs",
    "publish-crate.rs", "wait-for-crate.rs", "smoke-test-published-crate.rs",
    "collect-changelog.rs",
)
MANIFEST = '[package]\nname="example-sum-package-name"\nversion="1.0.0"\n'
FRAGMENT = "---\nbump: patch\n---\n\n### Fixed\n\n- Fix a bug.\n"
OUTPUTS = {
    "get-version.rs": "version=1.0.0",
    "get-bump-type.rs": "has_fragments=false",
    "detect-code-changes.rs": "rs-changed=true",
    "publish-crate.rs": "publish_result=skipped",
    "wait-for-crate.rs": "crate_available=skipped",
    "smoke-test-published-crate.rs": "smoke_test=skipped",
}


class ReleaseIoRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rust_script = shutil.which("rust-script")
        if not cls.rust_script:
            raise RuntimeError("install pinned rust-script before testing")
        for script in SCRIPTS:
            result = subprocess.run(
                [cls.rust_script, "--wrapper", "true", str(ROOT / "scripts" / script)],
                cwd=ROOT, env={**os.environ, "RUST_LOG": "error"},
                text=True, capture_output=True,
            )
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="issue-192-")
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.env = dict(os.environ)
        for key in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "RUST_ROOT"):
            self.env.pop(key, None)
        self.env.update(RUST_LOG="error", GITHUB_EVENT_NAME="push")
        (self.work / "Cargo.toml").write_text(MANIFEST)
        (self.work / "src").mkdir()
        (self.work / "src/lib.rs").write_text("pub fn fixture() {}\n")
        self.run_command(["git", "init", "-q", "-b", "main"], check=True)
        self.run_command(["git", "config", "user.name", "Test"], check=True)
        self.run_command(["git", "config", "user.email", "test@example.invalid"], check=True)
        self.run_command(["git", "add", "."], check=True)
        self.run_command(["git", "commit", "-qm", "fixture"], check=True)

    def run_command(self, args, check=False):
        return subprocess.run(args, cwd=self.work, env=self.env, text=True,
                              capture_output=True, timeout=60, check=check)

    def script(self, name):
        return self.run_command([self.rust_script, str(ROOT / "scripts" / name)])

    def test_configured_output_directory_is_fatal(self):
        self.env["GITHUB_OUTPUT"] = str(self.work)
        for script in OUTPUTS:
            with self.subTest(script=script):
                result = self.script(script)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("GITHUB_OUTPUT", result.stderr)
                self.assertIn(str(self.work), result.stderr)

    @unittest.skipUnless(Path("/dev/full").exists(), "Linux write-failure device")
    def test_output_write_failure_after_open_is_fatal(self):
        self.env["GITHUB_OUTPUT"] = "/dev/full"
        for script in OUTPUTS:
            with self.subTest(script=script):
                result = self.script(script)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("GITHUB_OUTPUT", result.stderr)

    def test_outputs_append_successfully(self):
        output = self.work / "outputs"
        output.write_text("existing=value\n")
        self.env["GITHUB_OUTPUT"] = str(output)
        for script, expected in OUTPUTS.items():
            with self.subTest(script=script):
                result = self.script(script)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(expected, output.read_text().splitlines())
        self.assertTrue(output.read_text().startswith("existing=value\n"))

    def test_unset_output_supports_local_use(self):
        for script, expected in OUTPUTS.items():
            with self.subTest(script=script):
                result = self.script(script)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(expected, result.stdout)

    def test_changelog_directory_read_failure_is_fatal(self):
        (self.work / "changelog.d").write_text("not a directory")
        for script in ("collect-changelog.rs", "get-bump-type.rs"):
            with self.subTest(script=script):
                result = self.script(script)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("changelog.d", result.stderr)
        self.assertFalse((self.work / "CHANGELOG.md").exists())

    def test_unreadable_fragment_is_preserved(self):
        fragments = self.work / "changelog.d"
        fragments.mkdir()
        (fragments / "good.md").write_text(FRAGMENT)
        (fragments / "broken.md").mkdir()
        for script in ("collect-changelog.rs", "get-bump-type.rs"):
            with self.subTest(script=script):
                result = self.script(script)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("broken.md", result.stderr)
        self.assertTrue((fragments / "good.md").is_file())
        self.assertFalse((self.work / "CHANGELOG.md").exists())

    def test_successful_collection_preserves_readme_and_other_files(self):
        fragments = self.work / "changelog.d"
        fragments.mkdir()
        (fragments / "good.md").write_text(FRAGMENT)
        (fragments / "README.md").write_text("instructions\n")
        (fragments / "notes.txt").write_text("notes\n")
        result = self.script("collect-changelog.rs")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Changelog collection complete", result.stdout)
        self.assertIn("Fix a bug.", (self.work / "CHANGELOG.md").read_text())
        self.assertFalse((fragments / "good.md").exists())
        self.assertTrue((fragments / "README.md").exists())
        self.assertTrue((fragments / "notes.txt").exists())


if __name__ == "__main__":
    unittest.main()
