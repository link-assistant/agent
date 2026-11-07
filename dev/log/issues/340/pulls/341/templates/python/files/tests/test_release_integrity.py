"""Release recovery must preserve the entire validated source/dependency tree."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from scripts import version_and_commit as release


def git(*args):
    return subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def commit(message="metadata"):
    git("add", "-A")
    git("commit", "-m", message)
    return git("rev-parse", "HEAD")


def manifest(version="1.0.0", dependency="dep==1"):
    return f'[project]\nname = "example"\nversion = "{version}"\ndependencies = ["{dependency}"]\n[tool.other]\nversion = "preserve"\n'


def lock(version="1.0.0", dependency="1.0.0"):
    return f"""version = 1
[[package]]
name = "example"
version = "{version}"
source = {{ editable = "." }}
[[package]]
name = "dep"
version = "{dependency}"
source = {{ registry = "https://pypi.org/simple" }}
"""


@pytest.fixture(params=[".", "python"])
def repository(tmp_path, monkeypatch, request):
    repo = tmp_path / "repo"
    repo.mkdir()
    monkeypatch.chdir(repo)
    git("init", "--initial-branch=main")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.com")
    root = Path(request.param)
    root.mkdir(exist_ok=True)
    (root / "pyproject.toml").write_text(manifest())
    (root / "uv.lock").write_text(lock())
    (root / "source.py").write_text("validated = True\n")
    (root / "CHANGELOG.md").write_text("# Changelog\n")
    (root / "changelog.d").mkdir()
    (root / "changelog.d" / "fix.md").write_text("### Fixed\n- Bug\n")
    (root / "changelog.d" / "README.md").write_text("keep\n")
    Path("outside.txt").write_text("also validated\n")
    return root, commit("validated")


def metadata_child(root):
    (root / "pyproject.toml").write_text(manifest("1.0.1"))
    (root / "uv.lock").write_text(lock("1.0.1"))
    (root / "CHANGELOG.md").write_text("# Changelog\nRelease 1.0.1\n")
    (root / "changelog.d" / "fix.md").unlink()
    return commit()


def test_accepts_validated_commit_and_metadata_child(repository, monkeypatch):
    root, validated = repository
    release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())
    metadata_child(root)
    # Run from the nested package too: attestation must still cover the full repo.
    monkeypatch.chdir(root.resolve())
    release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())


@pytest.mark.parametrize("version", ["1.0.0", "1.0.1"])
@pytest.mark.parametrize(
    "drift",
    [
        "source",
        "manifest",
        "lock",
        "outside",
        "mode",
        "fragment",
        "readme",
        "lock-delete",
        "lock-version",
        "tool-version",
    ],
)
def test_rejects_source_or_dependency_drift_even_with_matching_versions(
    repository, version, drift
):
    root, validated = repository
    (root / "pyproject.toml").write_text(manifest(version))
    (root / "uv.lock").write_text(lock(version))
    if drift == "source":
        (root / "source.py").write_text("validated = False\n")
    elif drift == "manifest":
        (root / "pyproject.toml").write_text(manifest(version, "dep==2"))
    elif drift == "lock":
        (root / "uv.lock").write_text(lock(version, "2.0.0"))
    elif drift == "outside":
        Path("outside.txt").write_text("unvalidated\n")
    elif drift == "mode":
        (root / "source.py").chmod(0o755)
    elif drift == "fragment":
        (root / "changelog.d" / "fix.md").write_text("unvalidated change")
    elif drift == "readme":
        (root / "changelog.d" / "README.md").unlink()
    elif drift == "lock-delete":
        (root / "uv.lock").unlink()
    elif drift == "lock-version":
        (root / "uv.lock").write_text(lock("9.9.9"))
    elif drift == "tool-version":
        path = root / "pyproject.toml"
        path.write_text(path.read_text().replace('"preserve"', '"changed"'))
    commit()
    with pytest.raises(ValueError):
        release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())


def test_rejects_lost_validated_parent(repository):
    root, validated = repository
    metadata_child(root)
    (root / "CHANGELOG.md").write_text("another release")
    commit()
    with pytest.raises(ValueError, match="sole parent"):
        release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())


def remote_for(repository, tmp_path):
    root, validated = repository
    remote = tmp_path / "remote.git"
    git("init", "--bare", "--initial-branch=main", str(remote))
    git("remote", "add", "origin", str(remote))
    git("push", "origin", "main")
    return root, validated


def test_remote_recovery_adopts_verified_child(repository, tmp_path):
    root, validated = remote_for(repository, tmp_path)
    child = metadata_child(root)
    git("push", "origin", "main")
    git("reset", "--hard", validated)
    assert release.check_remote_changes(
        root / "pyproject.toml", (root / "pyproject.toml").as_posix(), validated
    ) == (True, "1.0.1")
    assert git("rev-parse", "HEAD") == child
    assert (root / "pyproject.toml").read_text() == manifest("1.0.1")


@pytest.mark.parametrize("version", ["1.0.0", "1.0.1"])
def test_remote_recovery_rejects_unvalidated_source(repository, tmp_path, version):
    root, validated = remote_for(repository, tmp_path)
    (root / "source.py").write_text("unvalidated\n")
    (root / "pyproject.toml").write_text(manifest(version))
    (root / "uv.lock").write_text(lock(version))
    commit()
    git("push", "origin", "main")
    git("reset", "--hard", validated)
    with pytest.raises(ValueError, match="drift"):
        release.check_remote_changes(
            root / "pyproject.toml", (root / "pyproject.toml").as_posix(), validated
        )
    assert git("rev-parse", "HEAD") == validated


def test_push_race_rejects_remote_source_before_rebase(
    repository, tmp_path, monkeypatch
):
    root, validated = remote_for(repository, tmp_path)
    (root / "source.py").write_text("unvalidated\n")
    remote_child = commit("unvalidated")
    git("push", "origin", "main")
    git("reset", "--hard", validated)
    local_child = metadata_child(root)
    with pytest.raises(ValueError, match="drift"):
        release.push_branch_with_rebase_retry(
            "main",
            validated_sha=validated,
            pyproject_git_path=(root / "pyproject.toml").as_posix(),
        )
    assert git("rev-parse", "HEAD") == local_child
    assert git("rev-parse", "origin/main") == remote_child


def test_dirty_checkout_is_not_reset_or_pushed(repository, tmp_path):
    root, validated = remote_for(repository, tmp_path)
    Path("untracked.py").write_text("not validated")
    with pytest.raises(ValueError, match="dirty"):
        release.check_remote_changes(
            root / "pyproject.toml", (root / "pyproject.toml").as_posix(), validated
        )
    assert Path("untracked.py").exists()


def test_manual_workflow_carries_validated_sha():
    workflow = Path(__file__).resolve().parents[1] / ".github/workflows/release.yml"
    assert "VALIDATED_SHA: ${{ github.sha }}" in workflow.read_text()


def test_rebase_result_is_attested_before_another_push(
    repository, tmp_path, monkeypatch
):
    root, validated = remote_for(repository, tmp_path)
    metadata_child(root)
    calls = []

    def fake_git(cmd):
        calls.append(cmd)
        if cmd[:2] == ["git", "push"]:
            return subprocess.CompletedProcess(
                cmd, 1, stdout="", stderr="! [rejected] (fetch first)"
            )
        assert cmd[:3] == ["git", "pull", "--rebase"]
        # Simulate a second remote movement arriving with pull's own fetch.
        (root / "source.py").write_text("unvalidated during rebase")
        git("add", "-A")
        git("commit", "--amend", "--no-edit")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(release, "run_git_capturing", fake_git)
    with pytest.raises(ValueError, match="drift"):
        release.push_branch_with_rebase_retry(
            "main",
            validated_sha=validated,
            pyproject_git_path=(root / "pyproject.toml").as_posix(),
        )
    assert len(calls) == 2


def test_push_race_adopts_verified_equivalent_release(repository, tmp_path):
    root, validated = remote_for(repository, tmp_path)
    child = metadata_child(root)
    git("push", "origin", "main")
    git("reset", "--hard", validated)
    metadata_child(root)
    git("commit", "--amend", "-m", "different metadata commit identity")
    assert git("rev-parse", "HEAD") != child
    release.push_branch_with_rebase_retry(
        "main",
        validated_sha=validated,
        pyproject_git_path=(root / "pyproject.toml").as_posix(),
    )
    assert git("rev-parse", "HEAD") == child


def test_missing_validated_commit_fails_closed(repository):
    root, _ = repository
    with pytest.raises(SystemExit):
        release.attest_release("0" * 40, "HEAD", (root / "pyproject.toml").as_posix())


def test_nested_checkout_cannot_hide_source_drift_outside_package(
    repository, monkeypatch
):
    root, validated = repository
    Path("outside.txt").write_text("unvalidated")
    commit()
    monkeypatch.chdir(root.resolve())
    with pytest.raises(ValueError, match="outside.txt"):
        release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())


def test_local_metadata_child_resumes_push_without_another_bump(repository, tmp_path):
    root, validated = remote_for(repository, tmp_path)
    child = metadata_child(root)
    assert release.check_remote_changes(
        root / "pyproject.toml", (root / "pyproject.toml").as_posix(), validated
    ) == (True, "1.0.1")
    assert git("rev-parse", "HEAD") == child
    assert git("rev-parse", "origin/main") == child


def test_unrelated_metadata_commit_is_not_a_prior_release(repository):
    root, validated = repository
    (root / "CHANGELOG.md").write_text("unrelated docs edit")
    commit()
    with pytest.raises(ValueError, match="must change project.version"):
        release.attest_release(validated, "HEAD", (root / "pyproject.toml").as_posix())


def test_push_publishes_attested_head_from_detached_checkout(repository, tmp_path):
    root, validated = remote_for(repository, tmp_path)
    git("checkout", "--detach")
    child = metadata_child(root)
    assert git("rev-parse", "main") == validated
    release.push_branch_with_rebase_retry(
        "main",
        validated_sha=validated,
        pyproject_git_path=(root / "pyproject.toml").as_posix(),
    )
    assert git("rev-parse", "origin/main") == child


def test_merge_child_cannot_replace_validated_parent(repository):
    root, validated = repository
    tree = git("rev-parse", "HEAD^{tree}")
    other = git("commit-tree", tree, "-m", "unrelated parent")
    merged = git("commit-tree", tree, "-p", validated, "-p", other, "-m", "merge")
    with pytest.raises(ValueError, match="sole parent"):
        release.attest_release(validated, merged, (root / "pyproject.toml").as_posix())
