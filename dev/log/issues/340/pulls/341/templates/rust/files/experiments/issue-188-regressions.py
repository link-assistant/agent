#!/usr/bin/env python3
"""Offline regressions for release guards, installation and publish credentials.

Run from any directory with python3 experiments/issue-188-regressions.py -v.
Every Git origin is local; fake cargo/curl never publish or expose credentials.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUST_SCRIPT = shutil.which("rust-script")


class Regressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not RUST_SCRIPT:
            raise RuntimeError("install pinned rust-script before testing")
        # Build with real Cargo before a test puts its fake cargo on PATH.
        # The wrapper prevents execution (and thus any accidental publication).
        for script in ("publish-crate.rs", "check-version-modification.rs", "check-changelog-fragment.rs"):
            result = subprocess.run([RUST_SCRIPT, "--force", "--wrapper", "true",
                                     str(ROOT / "scripts" / script)], cwd=ROOT,
                                    env={**os.environ, "RUST_LOG": "error"},
                                    text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="issue-188-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.env = dict(os.environ)
        self.env["RUST_LOG"] = "error"
        self.env.pop("RUST_SCRIPT_VERSION", None)
        for key in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY", "RUST_ROOT",
                    "CARGO_REGISTRY_TOKEN", "CARGO_TOKEN", "DOCKERHUB_IMAGE",
                    "DOCKERHUB_USERNAME", "DOCKERHUB_TOKEN"):
            self.env.pop(key, None)

    def run_command(self, args, **kwargs):
        return subprocess.run(args, cwd=self.work, env=self.env,
                              text=True, capture_output=True, **kwargs)

    def git(self, *args):
        result = self.run_command(["git", *args])
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def write(self, name, content):
        dest = self.work / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)
        return dest

    def stub(self, name, content):
        dest = self.write("bin/" + name, content)
        dest.chmod(0o755)
        self.env["PATH"] = str(dest.parent) + os.pathsep + self.env["PATH"]

    def repository(self, root=""):
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        self.write(root + "Cargo.toml", '[package]\nname="fixture"\nversion="1.0.0"\n')
        self.write(root + "src/lib.rs", "pub fn original() {}\n")
        self.write(root + "changelog.d/existing.md", "### Fixed\n- Existing\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.git("remote", "add", "origin", str(self.work))
        self.git("fetch", "origin", "main:refs/remotes/origin/main")
        self.env.update(GITHUB_EVENT_NAME="pull_request", GITHUB_BASE_REF="main",
                        GITHUB_HEAD_REF="feature/test")

    def script(self, name):
        self.assertIsNotNone(RUST_SCRIPT, "install pinned rust-script before testing")
        return self.run_command([RUST_SCRIPT, str(ROOT / "scripts" / name)])

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "change")

    def test_release_branch_cannot_bypass_version_guard(self):
        self.repository()
        self.write("Cargo.toml", '[package]\nname="fixture"\nversion="2.0.0"\n')
        self.commit()
        self.env["GITHUB_HEAD_REF"] = "release/test"
        result = self.script("check-version-modification.rs")
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_version_formatting_and_dependency_versions_are_allowed(self):
        self.repository()
        self.write("Cargo.toml", "[package]\nname='fixture'\n  version = '1.0.0'\n"
                   "[dependencies.helper]\nversion='2.0.0'\n")
        self.commit()
        result = self.script("check-version-modification.rs")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_workspace_member_version_is_guarded(self):
        self.repository("rust/member/")
        self.write("rust/Cargo.toml", '[workspace]\nmembers=["member"]\n')
        self.commit()
        self.git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.write("rust/member/Cargo.toml", '[package]\nname="fixture"\nversion="2.0.0"\n')
        self.commit()
        result = self.script("check-version-modification.rs")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_absolute_and_dotted_roots_cannot_bypass_version_guard(self):
        self.repository("rust/")
        self.write("rust/Cargo.toml", '[package]\nname="fixture"\nversion="2.0.0"\n')
        self.commit()
        for root in (str(self.work / "rust"), "./rust/"):
            self.env["RUST_ROOT"] = root
            self.assertNotEqual(self.script("check-version-modification.rs").returncode, 0)

    def test_workspace_inherited_version_and_invalid_toml_are_guarded(self):
        self.repository()
        for content in ('[workspace.package]\nversion="2.0.0"\n', '[package\n'):
            self.write("Cargo.toml", content)
            self.commit()
            self.assertNotEqual(self.script("check-version-modification.rs").returncode, 0)

    def test_editing_an_existing_fragment_does_not_satisfy_guard(self):
        self.repository()
        self.write("src/lib.rs", "pub fn changed() {}\n")
        self.write("changelog.d/existing.md", "### Fixed\n- Edited\n")
        self.commit()
        result = self.script("check-changelog-fragment.rs")
        self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_dependabot_exemption_uses_author_even_on_a_spoofed_branch(self):
        self.repository()
        self.write("src/lib.rs", "pub fn changed() {}\n")
        self.commit()
        self.env["GITHUB_HEAD_REF"] = "dependabot/cargo/update"
        for author, exempt in (("dependabot[bot]", True), ("human", False), ("", False)):
            self.env["PR_AUTHOR"] = author
            result = self.script("check-changelog-fragment.rs")
            self.assertEqual(result.returncode == 0, exempt, result.stdout + result.stderr)

    def test_new_nested_fragment_satisfies_guard(self):
        self.repository("rust/")
        self.write("rust/src/lib.rs", "pub fn changed() {}\n")
        self.write("rust/changelog.d/new.md", "### Fixed\n- New\n")
        self.commit()
        result = self.script("check-changelog-fragment.rs")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_workspace_source_needs_a_collectable_new_fragment(self):
        self.repository("rust/")
        self.write("rust/member/src/lib.rs", "pub fn changed() {}\n")
        self.write("rust/changelog.d/subdirectory/new.md", "### Fixed\n- Not collected\n")
        self.commit()
        self.env["RUST_ROOT"] = str(self.work / "rust")
        self.assertNotEqual(self.script("check-changelog-fragment.rs").returncode, 0)
        self.write("rust/changelog.d/new.md", "### Fixed\n- New\n")
        self.commit()
        result = self.script("check-changelog-fragment.rs")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_missing_base_fails_both_guards(self):
        self.repository()
        self.env["GITHUB_BASE_REF"] = "missing"
        for script in ("check-version-modification.rs", "check-changelog-fragment.rs"):
            with self.subTest(script=script):
                self.assertNotEqual(self.script(script).returncode, 0)

    def test_publish_keeps_token_out_of_cargo_arguments(self):
        self.write("Cargo.toml", '[package]\nname="fixture"\nversion="1.0.0"\n')
        self.stub("cargo", "#!/usr/bin/env python3\nimport json,os,sys\n"
                  "open('command.json','w').write(json.dumps({'args':sys.argv[1:],"
                  "'token':os.environ.get('CARGO_REGISTRY_TOKEN')}))\n")
        self.env["CARGO_TOKEN"] = "mock-publish-credential"
        result = self.script("publish-crate.rs")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads((self.work / "command.json").read_text())
        self.assertNotIn("--token", data["args"])
        self.assertNotIn("mock-publish-credential", data["args"])
        self.assertEqual(data["token"], "mock-publish-credential")

    def test_installer_replaces_wrong_cached_version_with_exact_pin(self):
        self.stub("rust-script", "#!/usr/bin/env bash\necho 'rust-script 0.136.0'\n")
        self.stub("cargo", "#!/usr/bin/env python3\nimport json,sys\n"
                  "open('install.json','w').write(json.dumps(sys.argv[1:]))\n")
        result = self.run_command(["bash", str(ROOT / "scripts/install-rust-script.sh")])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.work / "install.json").exists(), result.stdout)
        args = json.loads((self.work / "install.json").read_text())
        self.assertEqual(args[args.index("--version") + 1], "0.36.0")
        self.assertIn("--locked", args)
        self.assertIn("--force", args)

    def test_installer_reuses_matching_pin(self):
        self.stub("rust-script", "#!/usr/bin/env bash\necho 'rust-script 0.36.0'\n")
        self.stub("cargo", "#!/usr/bin/env bash\nexit 1\n")
        result = self.run_command(["bash", str(ROOT / "scripts/install-rust-script.sh")])
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_installer_retries_three_times_then_fails(self):
        self.stub("rust-script", "#!/usr/bin/env bash\necho 'rust-script 0.1.0'\n")
        self.stub("sleep", "#!/usr/bin/env bash\nexit 0\n")
        self.stub("cargo", "#!/usr/bin/env bash\necho attempt >> attempts.txt\nexit 1\n")
        result = self.run_command(["bash", str(ROOT / "scripts/install-rust-script.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.work / "attempts.txt").read_text().splitlines(), ["attempt"] * 3)

    def test_cargo_manifest_warnings_fail_gate(self):
        self.write("Cargo.toml", '[package]\nname="fixture"\nversion="1.0.0"\n'
                   'edition="2021"\nunused-key=true\n')
        self.write("src/lib.rs", "pub fn fine() {}\n")
        self.run_command(["cargo", "generate-lockfile", "--offline"])
        original = self.run_command(["cargo", "check", "--locked", "--all-targets", "--all-features"])
        self.assertEqual(original.returncode, 0, original.stderr)
        self.assertIn("unused manifest key", original.stdout + original.stderr)
        result = self.run_command(["bash", str(ROOT / "scripts/check-cargo-warnings.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unused manifest key", result.stdout + result.stderr)

    def test_duplicate_target_warning_fails_gate(self):
        self.write("Cargo.toml", '[package]\nname="fixture"\nversion="1.0.0"\n'
                   'edition="2021"\n[[bin]]\nname="first"\npath="src/main.rs"\n'
                   '[[bin]]\nname="second"\npath="src/main.rs"\n')
        self.write("src/main.rs", "fn main() {}\n")
        self.run_command(["cargo", "generate-lockfile", "--offline"])
        result = self.run_command(["bash", str(ROOT / "scripts/check-cargo-warnings.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("multiple build targets", result.stdout + result.stderr)

    def test_cargo_error_status_is_preserved_without_warning(self):
        self.stub("cargo", "#!/usr/bin/env bash\necho 'error: fixture failure' >&2\nexit 23\n")
        result = self.run_command(["bash", str(ROOT / "scripts/check-cargo-warnings.sh")])
        self.assertEqual(result.returncode, 23)


if __name__ == "__main__":
    unittest.main()
