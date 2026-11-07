#!/usr/bin/env python3
"""Exercise rename-sensitive CI guards against isolated, local Git repositories.

Run with python3 experiments/issue-190-rename-regressions.py -v.
Compilation happens before the bounded CLI probes; no network origin is used.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUST_SCRIPT = shutil.which("rust-script")
FRAGMENT = "---\nbump: patch\n---\n\n### Fixed\n\n- Fix a bug.\n"


class RenameRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not RUST_SCRIPT:
            raise RuntimeError("install pinned rust-script before testing")
        for script in ("check-changelog-fragment.rs", "detect-code-changes.rs"):
            result = subprocess.run(
                [RUST_SCRIPT, "--wrapper", "true", str(ROOT / "scripts" / script)],
                cwd=ROOT, env={**os.environ, "RUST_LOG": "error"},
                text=True, capture_output=True,
            )
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)

    def repository(self, prefix, renames):
        temp = tempfile.TemporaryDirectory(prefix="issue-190-")
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name)
        self.env = dict(os.environ)
        for key in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "RUST_ROOT"):
            self.env.pop(key, None)
        self.env.update(GITHUB_BASE_REF="main", GITHUB_EVENT_NAME="pull_request")
        self.env["RUST_LOG"] = "error"
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "diff.renames", renames)
        self.write(prefix + "Cargo.toml", '[package]\nname="fixture"\nversion="1.0.0"\n')
        self.write(prefix + "src/lib.rs", "pub fn original() {}\n")
        self.write(prefix + "changelog.d/old.md", FRAGMENT)
        self.commit("base")
        self.git("remote", "add", "origin", str(self.work))
        self.git("fetch", "origin", "main:refs/remotes/origin/main")
        self.git("checkout", "-qb", "feature")

    def run_command(self, args):
        return subprocess.run(args, cwd=self.work, env=self.env, text=True,
                              capture_output=True, timeout=60)

    def git(self, *args):
        result = self.run_command(["git", *args])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def write(self, name, content):
        path = self.work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def script(self, name):
        return self.run_command([RUST_SCRIPT, str(ROOT / "scripts" / name)])

    def test_replaced_fragment_counts_as_new(self):
        for prefix in ("", "rust/"):
            for renames in ("true", "false"):
                with self.subTest(prefix=prefix, renames=renames):
                    self.repository(prefix, renames)
                    self.git("rm", prefix + "changelog.d/old.md")
                    self.write(prefix + "changelog.d/new.md",
                               FRAGMENT.replace("Fix a bug.", "Fix another bug."))
                    self.write(prefix + "src/lib.rs", "pub fn changed() {}\n")
                    self.commit("replace fragment")
                    # Prove this fixture triggers the default similarity heuristic.
                    status = self.git("-c", "diff.renames=true", "diff", "--name-status",
                                      "origin/main...HEAD", "--", prefix + "changelog.d")
                    self.assertTrue(status.startswith("R"), status)
                    result = self.script("check-changelog-fragment.rs")
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("Changelog fragments added: 1", result.stdout)

    def test_unchanged_fragment_move_does_not_count_as_new(self):
        for prefix in ("", "rust/"):
            for renames in ("true", "false"):
                with self.subTest(prefix=prefix, renames=renames):
                    self.repository(prefix, renames)
                    self.git("mv", prefix + "changelog.d/old.md",
                             prefix + "changelog.d/moved.md")
                    self.write(prefix + "src/lib.rs", "pub fn changed() {}\n")
                    self.commit("move fragment unchanged")
                    result = self.script("check-changelog-fragment.rs")
                    self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                    self.assertIn("Changelog fragments added: 0", result.stdout)
                    self.assertIn("No changelog fragment found", result.stderr)

    def move_source(self, prefix):
        (self.work / (prefix + "examples")).mkdir(parents=True)
        self.git("mv", prefix + "src/lib.rs", prefix + "examples/lib.rs")
        self.commit("move source out of src")

    def test_source_move_requires_fragment(self):
        for prefix in ("", "rust/"):
            with self.subTest(prefix=prefix):
                self.repository(prefix, "true")
                self.move_source(prefix)
                result = self.script("check-changelog-fragment.rs")
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("No changelog fragment found", result.stderr)
                self.assertIn("  " + prefix + "src/lib.rs", result.stdout)

    def test_source_move_activates_code_jobs(self):
        for prefix in ("", "rust/"):
            for context in ("push", "push_merge", "pull_request", "pull_request_first_commit"):
                with self.subTest(prefix=prefix, context=context):
                    self.repository(prefix, "true")
                    if context == "pull_request_first_commit":
                        # Exercise the HEAD^ -> HEAD^2 fallback: PR head has no parent.
                        self.git("checkout", "--orphan", "first-commit")
                    self.move_source(prefix)
                    branch = self.git("branch", "--show-current")
                    if context != "push":
                        self.git("checkout", "main")
                        self.git("merge", "--no-ff", "--allow-unrelated-histories",
                                 branch, "-m", "synthetic PR merge")
                    self.env["GITHUB_EVENT_NAME"] = (
                        "push" if context.startswith("push") else "pull_request"
                    )
                    result = self.script("detect-code-changes.rs")
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("  " + prefix + "src/lib.rs", result.stdout)
                    self.assertIn("  " + prefix + "examples/lib.rs", result.stdout)
                    self.assertIn("rs-changed=true", result.stdout)
                    self.assertIn("any-code-changed=true", result.stdout)


if __name__ == "__main__":
    unittest.main()
