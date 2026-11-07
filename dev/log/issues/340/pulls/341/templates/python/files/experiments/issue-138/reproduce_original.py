#!/usr/bin/env python3
"""Offline, finite reproductions using immutable original template helpers.

Run from the repository root: python experiments/issue-138/reproduce_original.py
Only `git show` reads real Git state; all release helper Git calls are mocked.
"""

import subprocess
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

REF = "78f2fdf5e085871387555bc066071f0aedd24479"


def original(name):
    source = subprocess.run(
        ["git", "show", f"{REF}:scripts/{name}.py"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    module = types.ModuleType(name)
    exec(compile(source, f"{REF}:scripts/{name}.py", "exec"), module.__dict__)
    return module


release = original("version_and_commit")
sarif = original("check_codeql_results")
assert (
    release.classify_push_failure("remote: fatal error in commit_refs_rules")
    is release.PushFailure.OTHER
)
print("REPRODUCED: internal push error classified OTHER instead of transient")
payload = {
    "version": "2.1.0",
    "runs": [
        {
            "tool": {"driver": {"name": "CodeQL"}},
            "results": [],
            "invocations": [
                {
                    "executionSuccessful": True,
                    "toolExecutionNotifications": [
                        {"level": "error", "message": {"text": "Extraction failed"}},
                    ],
                }
            ],
        }
    ],
}
assert sarif.validate_report(payload) == []
print("REPRODUCED: successful invocation hides extraction errors")

with tempfile.TemporaryDirectory() as directory:
    manifest = Path(directory) / "pyproject.toml"
    manifest.write_text('[project]\nversion = "1.0.0"\n')
    for remote_version in ("1.0.0", "1.0.1"):
        calls = []

        def fake_command(cmd, **kwargs):
            calls.append(cmd)
            output = ""
            if cmd[1:] == ["rev-parse", "HEAD"]:
                output = "validated"
            elif cmd[1:] == ["rev-parse", "origin/main"]:
                output = "unvalidated-source-and-dependencies"
            elif cmd[1] == "show":
                output = f'[project]\nversion = "{remote_version}"\n'
            return subprocess.CompletedProcess(cmd, 0, stdout=output, stderr="")

        with patch.object(release, "run_command", fake_command):
            released, _ = release.check_remote_changes(manifest, "pyproject.toml")
        if remote_version == "1.0.0":
            assert released
            print(
                "REPRODUCED: matching version accepts unvalidated remote without adopting it"
            )
        else:
            assert ["git", "rebase", "origin/main"] in calls
            print(
                "REPRODUCED: different version rebases without source/lock attestation"
            )
