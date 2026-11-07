#!/usr/bin/env python3
"""Verify the documented zizmor invocations against a Dependabot fixture.

Install zizmor==1.30.1 and run this file; ZIZMOR may name its executable.
The fixture stays outside the repository, so it never affects normal audits.
"""
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def commands():
    lines = (ROOT / ".github/workflows/workflows.yml").read_text().splitlines()
    found = []
    for index, line in enumerate(lines):
        if "pipx run zizmor==" not in line:
            continue
        command = line.strip().removeprefix("#").strip()
        while command.endswith("\\"):
            index += 1
            command = command[:-1] + lines[index].strip().removeprefix("#").strip()
        found.append(shlex.split(command))
    return found


class ZizmorInputs(unittest.TestCase):
    def test_dependabot_is_collected_by_both_commands(self):
        zizmor = os.environ.get("ZIZMOR") or shutil.which("zizmor")
        self.assertIsNotNone(zizmor, "install zizmor==1.30.1")
        version = subprocess.check_output([zizmor, "--version"], text=True)
        self.assertIn("1.30.1", version)
        invocations = commands()
        self.assertEqual(len(invocations), 2)
        with tempfile.TemporaryDirectory(prefix="issue-193-") as directory:
            work = Path(directory)
            subprocess.run(["git", "init", "-q", directory], check=True)
            github = work / ".github"
            (github / "workflows").mkdir(parents=True)
            (github / "actions").mkdir()
            shutil.copy(ROOT / ".github/zizmor.yml", github / "zizmor.yml")
            (github / "workflows/test.yml").write_text(
                "name: Test\non: push\npermissions: {contents: read}\njobs:\n"
                "  test:\n    runs-on: ubuntu-24.04\n    steps:\n"
                "      - run: echo test\n"
            )
            (github / "dependabot.yml").write_text(
                "version: 2\nupdates:\n  - package-ecosystem: cargo\n"
                "    directory: /\n    schedule: {interval: weekly}\n"
            )
            for invocation in invocations:
                with self.subTest(command=invocation):
                    self.assertEqual(invocation[2], "zizmor==1.30.1")
                    result = subprocess.run(
                        [zizmor, "--offline", "--format", "json", *invocation[3:]],
                        cwd=work, text=True, capture_output=True, timeout=30,
                        env={**os.environ, "RUST_LOG": "debug"},
                    )
                    collected = [line for line in result.stderr.splitlines()
                                 if "registering" in line and "dependabot.yml" in line]
                    self.assertTrue(collected, result.stderr)
                    if "regular" in invocation:
                        self.assertIn("dependabot-cooldown", result.stdout, result.stderr)
                        self.assertNotEqual(result.returncode, 0)
                    else:
                        # The high-severity filter intentionally hides cooldown
                        # findings; check collection without weakening that gate.
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            # Confirm the suggested seven-day policy resolves that finding.
            path = github / "dependabot.yml"
            path.write_text(path.read_text() + "    cooldown: {default-days: 7}\n")
            result = subprocess.run(
                [zizmor, "--offline", "--format", "json", "."],
                cwd=work, text=True, capture_output=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("dependabot-cooldown", result.stdout, result.stderr)


if __name__ == "__main__":
    unittest.main()
