"""Tests for scripts/version_and_commit.py (issue #67)."""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.create_github_release import extract_changelog_entry


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent / "scripts" / "version_and_commit.py"
)
spec = importlib.util.spec_from_file_location("version_and_commit", SCRIPT_PATH)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)  # type: ignore[union-attr]


def mock_push_attestation(monkeypatch):
    """Isolate subprocess retry policy; real Git attestation has its own suite."""
    monkeypatch.setattr(module, "git_text", lambda args: "validated")
    monkeypatch.setattr(module, "assert_clean_checkout", lambda: None)
    monkeypatch.setattr(module, "attest_release", lambda *args: None)
    monkeypatch.setattr(module, "run_command", lambda *args, **kwargs: None)


def test_parse_version_reads_project_table_not_other_tables() -> None:
    """A version key in another table must not shadow project.version."""
    content = """
[tool.scriv]
version = "scripted"

[project]
name = "example"
version = "2.3.4"
"""
    assert module.parse_version(content) == "2.3.4"


def test_parse_version_fails_loudly_when_project_version_is_missing() -> None:
    with pytest.raises(ValueError, match="no project.version"):
        module.parse_version("[project]\nname = 'example'\n")


def test_parse_version_fails_loudly_on_invalid_toml() -> None:
    with pytest.raises(ValueError, match="not valid TOML"):
        module.parse_version("not toml at all ][")


def test_get_current_version_reads_file(tmp_path: Path) -> None:
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text("[project]\nversion = '3.1.4'\n")
    assert module.get_current_version(pyproject) == "3.1.4"


@pytest.mark.parametrize(
    ("bump_type", "expected_version", "with_fragment"),
    [
        ("patch", "0.1.1", True),
        ("minor", "0.2.0", True),
        ("major", "1.0.0", True),
        ("patch", "0.1.1", False),
    ],
)
def test_manual_release_writes_changelog_for_numeric_version(
    tmp_path: Path, bump_type: str, expected_version: str, with_fragment: bool
) -> None:
    """The numeric version and its notes must be committed together."""
    source_root = SCRIPT_PATH.parents[1]
    remote = tmp_path / "remote.git"
    repo = tmp_path / "repo"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(remote)], check=True
    )
    subprocess.run(["git", "clone", str(remote), str(repo)], check=True)
    (repo / "scripts").mkdir()
    for name in ("version_and_commit.py", "bump_version.py"):
        shutil.copy2(source_root / "scripts" / name, repo / "scripts" / name)
    (repo / "pyproject.toml").write_text(
        source_root.joinpath("pyproject.toml").read_text(), encoding="utf-8"
    )
    (repo / "CHANGELOG.md").write_text(
        source_root.joinpath("CHANGELOG.md").read_text(), encoding="utf-8"
    )
    (repo / "changelog.d").mkdir()
    if with_fragment:
        (repo / "changelog.d" / "repro.fixed.md").write_text(
            "### Fixed\n\n- Reproduction.\n", encoding="utf-8"
        )
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "Initial",
        ],
        check=True,
    )
    subprocess.run(["git", "-C", str(repo), "push", "origin", "main"], check=True)

    result = subprocess.run(
        [sys.executable, "scripts/version_and_commit.py", "--bump-type", bump_type],
        cwd=repo,
        env={
            **os.environ,
            "PATH": f"{Path(sys.executable).parent}:{os.environ['PATH']}",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    changelog = (repo / "CHANGELOG.md").read_text(encoding="utf-8")
    if with_fragment:
        assert changelog.count(f"## [{expected_version}]") == 1
        assert "## [patch]" not in changelog
        assert "## [minor]" not in changelog
        assert "## [major]" not in changelog
        assert changelog.count("Reproduction.") == 1
        assert "Reproduction." in extract_changelog_entry(
            repo / "CHANGELOG.md", expected_version
        )
    else:
        assert changelog.count(f"## {expected_version} -") == 1
        assert "Manual patch release" in extract_changelog_entry(
            repo / "CHANGELOG.md", expected_version
        )
    assert not (repo / "changelog.d" / "repro.fixed.md").exists()
    assert module.get_current_version(repo / "pyproject.toml") == expected_version
    assert (
        subprocess.run(
            ["git", "-C", str(repo), "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        == ""
    )


RULESET_REJECTION = (
    "remote: error: GH006: Protected branch update failed for refs/heads/main.\n"
    "remote: - Changes must be made through a pull request.\n"
    "! [remote rejected] main -> main (push declined due to repository rule violations)\n"
    "error: failed to push some refs to 'github.com:example/example.git'"
)

LOST_RACE = (
    "To github.com:example/example.git\n"
    " ! [rejected]        main -> main (fetch first)\n"
    "error: failed to push some refs to 'github.com:example/example.git'\n"
    "hint: Updates were rejected because the remote contains work that you do not have locally."
)

REAL_ERROR = (
    "ssh: connect to host github.com port 22: Connection timed out\r\n"
    "fatal: Could not read from remote repository."
)


def test_repository_rules_are_classified_before_the_rebase_retry() -> None:
    """A ruleset refusal looks like a non-fast-forward but is policy, not a race."""
    assert (
        module.classify_push_failure(RULESET_REJECTION)
        is module.PushFailure.REPOSITORY_RULES
    )
    assert (
        module.classify_push_failure(RULESET_REJECTION.lower())
        is module.PushFailure.REPOSITORY_RULES
    )


def test_a_lost_race_is_classified_for_the_rebase_retry() -> None:
    assert module.classify_push_failure(LOST_RACE) is module.PushFailure.LOST_RACE


def test_other_failures_never_trigger_a_rebase() -> None:
    assert module.classify_push_failure(REAL_ERROR) is module.PushFailure.OTHER


def test_lost_race_is_rebased_and_push_succeeds(monkeypatch, capsys) -> None:
    """A non-fast-forward triggers exactly one pull --rebase, then a retry."""
    commands: list[list[str]] = []

    def fake_run(cmd):
        commands.append(cmd)
        if cmd[:2] == ["git", "push"] and len(commands) == 1:
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=LOST_RACE)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    module.push_branch_with_rebase_retry("main")

    assert commands[0] == ["git", "push", "origin", "HEAD:refs/heads/main"]
    assert commands[1] == ["git", "pull", "--rebase", "origin", "main"]
    assert commands[2] == ["git", "push", "origin", "HEAD:refs/heads/main"]
    assert "Rebasing and retrying" in capsys.readouterr().err


def test_repository_rules_exit_without_retrying(monkeypatch, capsys) -> None:
    """Policy refusals must fail immediately; rebasing cannot change policy."""
    attempts: list[list[str]] = []

    def fake_run(cmd):
        attempts.append(cmd)
        if cmd[:2] == ["git", "push"]:
            return subprocess.CompletedProcess(
                cmd, 1, stdout="", stderr=RULESET_REJECTION
            )
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    with pytest.raises(SystemExit) as exc_info:
        module.push_branch_with_rebase_retry("main")

    assert exc_info.value.code == 1
    assert len(attempts) == 1
    captured = capsys.readouterr()
    assert "::error title=Push declined by repository rules::" in captured.err
    assert "cannot change repository policy" in captured.err


def test_other_failures_exit_without_retrying(monkeypatch, capsys) -> None:
    attempts: list[list[str]] = []

    def fake_run(cmd):
        attempts.append(cmd)
        if cmd[:2] == ["git", "push"]:
            return subprocess.CompletedProcess(cmd, 128, stdout="", stderr=REAL_ERROR)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    with pytest.raises(SystemExit) as exc_info:
        module.push_branch_with_rebase_retry("main")

    assert exc_info.value.code == 1
    assert len(attempts) == 1
    assert "Error pushing:" in capsys.readouterr().err


def test_persistent_race_gives_up_after_max_attempts(monkeypatch, capsys) -> None:
    commands: list[list[str]] = []

    def fake_run(cmd):
        commands.append(cmd)
        if cmd[:2] == ["git", "push"]:
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=LOST_RACE)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    with pytest.raises(SystemExit) as exc_info:
        module.push_branch_with_rebase_retry("main", max_attempts=3)

    assert exc_info.value.code == 1
    pushes = [cmd for cmd in commands if cmd[:2] == ["git", "push"]]
    rebases = [cmd for cmd in commands if cmd[:2] == ["git", "pull"]]
    assert len(pushes) == 3
    assert len(rebases) == 2
    assert "Error pushing after 3 attempts:" in capsys.readouterr().err


def test_failed_rebase_aborts_and_exits(monkeypatch, capsys) -> None:
    commands: list[list[str]] = []

    def fake_run(cmd):
        commands.append(cmd)
        if cmd[:2] == ["git", "pull"]:
            return subprocess.CompletedProcess(
                cmd, 1, stdout="", stderr="CONFLICT (content): Merge conflict in x"
            )
        if cmd[:2] == ["git", "push"]:
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=LOST_RACE)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    with pytest.raises(SystemExit) as exc_info:
        module.push_branch_with_rebase_retry("main")

    assert exc_info.value.code == 1
    assert ["git", "rebase", "--abort"] in commands
    assert "Error during pull --rebase:" in capsys.readouterr().err


INTERNAL_ERROR = "remote: fatal error in commit_refs_rules\n! [remote rejected] HEAD -> main (fatal error in commit_refs_rules)"


@pytest.mark.parametrize(
    "error",
    [
        INTERNAL_ERROR,
        "fatal: HTTP 429",
        "error: RPC failed; HTTP 503 curl 22",
        "fatal: unable to access: The requested URL returned error: 502",
    ],
)
def test_classifies_explicit_transient_failures(error):
    assert module.classify_push_failure(error) is module.PushFailure.TRANSIENT


@pytest.mark.parametrize("code", ["GH006", "GH013"])
def test_policy_precedes_internal_and_http_errors(code):
    assert (
        module.classify_push_failure(f"{code}: {INTERNAL_ERROR} HTTP 503")
        is module.PushFailure.REPOSITORY_RULES
    )


@pytest.mark.parametrize("succeed", [True, False])
def test_transient_push_retries_identical_commit_with_bounded_backoff(
    monkeypatch, capsys, succeed
):
    commands = []
    sleeps = []

    def fake_run(cmd):
        commands.append(cmd)
        ok = succeed and len(commands) == 2
        return subprocess.CompletedProcess(
            cmd, 0 if ok else 1, stdout="", stderr="" if ok else INTERNAL_ERROR
        )

    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", fake_run)
    monkeypatch.setattr(module.time, "sleep", sleeps.append)
    if succeed:
        module.push_branch_with_rebase_retry("main")
    else:
        with pytest.raises(SystemExit):
            module.push_branch_with_rebase_retry("main")
    assert commands == [["git", "push", "origin", "HEAD:refs/heads/main"]] * (
        2 if succeed else 3
    )
    assert sleeps == ([1] if succeed else [1, 2])
    assert INTERNAL_ERROR in capsys.readouterr().err


@pytest.mark.parametrize("debug", [False, True])
def test_attempt_diagnostics_are_default_off(monkeypatch, capsys, debug):
    monkeypatch.delenv("RELEASE_DEBUG", raising=False)
    if debug:
        monkeypatch.setenv("RELEASE_DEBUG", "1")
    responses = iter(
        [
            subprocess.CompletedProcess([], 1, stdout="", stderr=INTERNAL_ERROR),
            subprocess.CompletedProcess([], 0, stdout="", stderr=""),
        ]
    )
    mock_push_attestation(monkeypatch)
    monkeypatch.setattr(module, "run_git_capturing", lambda cmd: next(responses))
    monkeypatch.setattr(module.time, "sleep", lambda seconds: None)
    module.push_branch_with_rebase_retry("main")
    output = capsys.readouterr().err
    assert ("Release push attempt 1/3: TRANSIENT" in output) is debug
    assert INTERNAL_ERROR in output


@pytest.mark.parametrize(
    "message",
    [
        "HTTP 401",
        "HTTP 403",
        "HTTP 404",
        "HTTP 5000",
        "error 503",
        "commit_refs_rules",
        "permission denied",
    ],
)
def test_unrelated_errors_are_not_transient(message):
    assert module.classify_push_failure(message) is module.PushFailure.OTHER


@pytest.mark.parametrize("attempts", [0, 4])
def test_retry_budget_cannot_exceed_three_or_skip_push(attempts):
    with pytest.raises(ValueError, match="between 1 and 3"):
        module.push_branch_with_rebase_retry("main", max_attempts=attempts)
