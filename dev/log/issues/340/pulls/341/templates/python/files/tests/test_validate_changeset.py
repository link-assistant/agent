"""Exercise the changelog gate against real, isolated Git histories (issue #93)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts.validate_changeset import main, validate_fragment_content

ROOT = Path(__file__).resolve().parents[1]
VALID_FRAGMENT = "### Fixed\n\n- Document the source change.\n"


def test_dependabot_author_skips_before_resolving_refs(monkeypatch, capsys) -> None:
    monkeypatch.setenv("PR_AUTHOR", "dependabot[bot]")
    assert main(["--base-ref", "missing-ref", "--head-ref", "missing-ref"]) == 0
    assert "Skipping: PR opened by dependabot[bot]" in capsys.readouterr().out


@pytest.mark.parametrize(
    "author", ["contributor", "dependabot", "dependabot[bot]-fake", ""]
)
def test_other_authors_and_bot_named_branches_still_require_fragments(
    monkeypatch, author
) -> None:
    monkeypatch.setenv("PR_AUTHOR", author)
    monkeypatch.setenv("GITHUB_HEAD_REF", "dependabot/pip/group")
    assert main(["--base-ref", "missing-ref", "--head-ref", "missing-ref"]) == 1


def git(repo: Path, *args: str) -> str:
    """Run a local Git operation and surface its diagnostics on failure."""
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    return result.stdout.strip()


def commit(repo: Path) -> None:
    """Commit all fixture changes without relying on the user's Git identity."""
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "Fixture change")


@pytest.fixture(params=[".", "python"])
def project(tmp_path: Path, request: pytest.FixtureRequest) -> Path:
    """Create a standalone or multi-language project with a verified base ref."""
    git(tmp_path, "init", "-q", "--initial-branch=main")
    git(tmp_path, "config", "user.name", "Test")
    git(tmp_path, "config", "user.email", "test@example.com")
    project_root = tmp_path / request.param
    (project_root / "scripts").mkdir(parents=True)
    shutil.copy2(
        ROOT / "scripts/validate_changeset.py",
        project_root / "scripts/validate_changeset.py",
    )
    (project_root / "src").mkdir()
    (project_root / "src/code.py").write_text("value = 1\n", encoding="utf-8")
    (project_root / "changelog.d").mkdir()
    (project_root / "changelog.d/README.md").write_text(
        "Instructions.\n", encoding="utf-8"
    )
    commit(tmp_path)
    git(tmp_path, "branch", "base")
    return project_root


def repo_root(project: Path) -> Path:
    """Locate the fixture's containing repository for either layout."""
    return Path(git(project, "rev-parse", "--show-toplevel"))


def change_source(project: Path) -> None:
    """Make and commit the smallest package-code change."""
    (project / "src/code.py").write_text("value = 2\n", encoding="utf-8")
    commit(repo_root(project))


def run_validator(project: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run the copied script offline, passing refs through the CI environment."""
    return subprocess.run(
        [sys.executable, str(project / "scripts/validate_changeset.py"), *args],
        cwd=project.parent,
        env={
            **os.environ,
            "GITHUB_BASE_SHA": "base",
            "GITHUB_HEAD_SHA": "HEAD",
            "GITHUB_BASE_REF": "",
        },
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )


def test_source_change_without_added_fragment_fails(project: Path) -> None:
    """The issue's missing-fragment reproduction must return exit 1."""
    change_source(project)
    result = run_validator(project)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "No new changelog fragment" in result.stdout


@pytest.mark.parametrize("fragment_change", ["unchanged", "modified", "renamed"])
def test_inherited_fragment_cannot_satisfy_gate(
    project: Path, fragment_change: str
) -> None:
    """Only additions in this PR count, even when old fragments remain valid."""
    old_fragment = project / "changelog.d/old.md"
    old_fragment.write_text(VALID_FRAGMENT, encoding="utf-8")
    commit(repo_root(project))
    git(project, "branch", "-f", "base", "HEAD")
    change_source(project)
    if fragment_change == "modified":
        old_fragment.write_text(
            VALID_FRAGMENT + "- Another change.\n", encoding="utf-8"
        )
    elif fragment_change == "renamed":
        old_fragment.rename(project / "changelog.d/renamed.md")
    if fragment_change != "unchanged":
        commit(repo_root(project))
    result = run_validator(project)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "No new changelog fragment" in result.stdout


def test_new_valid_fragment_passes(project: Path) -> None:
    """A committed addition with a category and description satisfies the gate."""
    change_source(project)
    (project / "changelog.d/new fragment.md").write_text(
        VALID_FRAGMENT, encoding="utf-8"
    )
    commit(repo_root(project))
    result = run_validator(project)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "[OK] new fragment.md" in result.stdout


@pytest.mark.parametrize("description", ["- Fix another bug.", "-"])
def test_replacement_fragment_is_validated(project: Path, description: str) -> None:
    """A similar replacement counts as new and must pass content validation."""
    repo = repo_root(project)
    frontmatter = "---\nbump: patch\n---\n\n### Fixed\n\n"
    old_fragment = project / "changelog.d/old.md"
    old_fragment.write_text(frontmatter + "- Fix a bug.\n", encoding="utf-8")
    commit(repo)
    git(repo, "branch", "-f", "base", "HEAD")
    change_source(project)
    old_fragment.unlink()
    (project / "changelog.d/new.md").write_text(
        frontmatter + description + "\n", encoding="utf-8"
    )
    commit(repo)

    # Confirm the fixture exercises Git's default similarity-based pairing.
    diff = git(repo, "diff", "--name-status", "--find-renames", "base", "HEAD")
    assert any(line.startswith("R") for line in diff.splitlines()), diff

    result = run_validator(project, "--verbose")
    assert "1 new fragment(s)" in result.stdout, result.stdout + result.stderr
    if description == "-":
        assert result.returncode == 1, result.stdout + result.stderr
        assert "[FAIL] Fragment new.md has no content" in result.stdout
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        assert "[OK] new.md" in result.stdout


def test_untracked_fragment_does_not_count(project: Path) -> None:
    """A local file absent from the PR commit must not bypass enforcement."""
    change_source(project)
    (project / "changelog.d/untracked.md").write_text(VALID_FRAGMENT, encoding="utf-8")
    assert run_validator(project).returncode == 1


@pytest.mark.parametrize("name", ["README.md", "fragment.md.j2", "nested/new.md"])
def test_instruction_template_and_nested_files_do_not_count(
    project: Path, name: str
) -> None:
    """Only top-level Markdown fragments are consumed by the release process."""
    change_source(project)
    path = project / "changelog.d" / name
    path.parent.mkdir(exist_ok=True)
    path.write_text(VALID_FRAGMENT, encoding="utf-8")
    commit(repo_root(project))
    assert run_validator(project).returncode == 1


@pytest.mark.parametrize(
    "path", ["README.md", "docs/guide.py", "examples/demo.py", "experiments/probe.py"]
)
def test_documentation_and_examples_remain_exempt(project: Path, path: str) -> None:
    """Existing documentation and experimental-code exemptions are preserved."""
    changed = project / path
    changed.parent.mkdir(exist_ok=True)
    changed.write_text("Updated documentation.\n", encoding="utf-8")
    commit(repo_root(project))
    result = run_validator(project)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No source changes" in result.stdout


@pytest.mark.parametrize("operation", ["delete", "rename_to_docs"])
def test_source_removal_requires_fragment(project: Path, operation: str) -> None:
    """Deletion and moving code out of src/ are still source changes."""
    source = project / "src/code.py"
    if operation == "delete":
        source.unlink()
    else:
        (project / "docs").mkdir()
        source.rename(project / "docs/code.py")
    commit(repo_root(project))
    assert run_validator(project).returncode == 1


@pytest.mark.parametrize("ref_option", ["--base-ref", "--head-ref"])
def test_missing_ref_fails_even_without_source_changes(
    project: Path, ref_option: str
) -> None:
    """A failed comparison must never be mistaken for an empty PR diff."""
    result = run_validator(project, ref_option, "missing-ref")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "Cannot validate changelog" in result.stderr


def test_diverged_base_uses_merge_base(project: Path) -> None:
    """Source changes made only on the base branch must not enter the PR diff."""
    repo = repo_root(project)
    git(repo, "checkout", "-q", "base")
    (project / "src/code.py").write_text("value = 3\n", encoding="utf-8")
    commit(repo)
    git(repo, "checkout", "-q", "main")
    (project / "README.md").write_text("Docs only.\n", encoding="utf-8")
    commit(repo)
    result = run_validator(project)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "No source changes" in result.stdout


def test_unrelated_history_fails(project: Path) -> None:
    """Both refs existing is insufficient when there is no common ancestor."""
    repo = repo_root(project)
    git(repo, "checkout", "-q", "--orphan", "unrelated")
    git(repo, "commit", "-qm", "Unrelated root")
    git(repo, "checkout", "-q", "main")
    result = run_validator(project, "--base-ref", "unrelated")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "Cannot validate changelog" in result.stderr


def test_non_git_project_fails(tmp_path: Path) -> None:
    """The original offline fixture without Git must now fail closed."""
    (tmp_path / "scripts").mkdir()
    shutil.copy2(
        ROOT / "scripts/validate_changeset.py",
        tmp_path / "scripts/validate_changeset.py",
    )
    result = run_validator(tmp_path)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "Cannot validate changelog" in result.stderr


@pytest.mark.parametrize(
    ("content", "valid"),
    [
        ("", False),
        ("### Fixed\n", False),
        ("<!--\n### Fixed\n- Placeholder\n-->\n", False),
        ("<!--\n### Fixed\n-->\n- Uncategorized change\n", False),
        ("### Fixedness\n- Invalid category\n", False),
        ("Text before heading\n### Fixed\n", False),
        ("### Fixed\n<!-- Placeholder -->\n", False),
        ("### Fixed\n-\n", False),
        (VALID_FRAGMENT, True),
        ("### added\nDescription of the feature.\n", True),
    ],
)
def test_fragment_content_requires_visible_category_and_description(
    tmp_path: Path, content: str, valid: bool
) -> None:
    """Commented templates, empty categories and prefix matches are invalid."""
    fragment = tmp_path / "fragment.md"
    fragment.write_text(content, encoding="utf-8")
    assert validate_fragment_content(fragment)[0] is valid


def test_every_added_fragment_is_validated(project: Path) -> None:
    """One valid addition must not hide an invalid addition in the same PR."""
    change_source(project)
    (project / "changelog.d/valid.md").write_text(VALID_FRAGMENT, encoding="utf-8")
    (project / "changelog.d/empty.md").write_text("", encoding="utf-8")
    commit(repo_root(project))
    result = run_validator(project)
    assert result.returncode == 1
    assert "[FAIL]" in result.stdout


def test_invalid_added_fragment_fails_without_source_changes(project: Path) -> None:
    """New fragments are checked even when the rest of the diff is exempt."""
    (project / "changelog.d/empty.md").write_text("", encoding="utf-8")
    commit(repo_root(project))
    assert run_validator(project).returncode == 1


def test_missing_fragment_directory_fails(project: Path) -> None:
    """A missing directory must produce the same clear failure as no additions."""
    shutil.rmtree(project / "changelog.d")
    change_source(project)
    result = run_validator(project)
    assert result.returncode == 1
    assert "No new changelog fragment" in result.stdout


def test_inherited_invalid_fragment_is_ignored(project: Path) -> None:
    """An unrelated invalid fragment on the base must not block a valid PR."""
    (project / "changelog.d/old.md").write_text("", encoding="utf-8")
    commit(repo_root(project))
    git(project, "branch", "-f", "base", "HEAD")
    change_source(project)
    (project / "changelog.d/new.md").write_text(VALID_FRAGMENT, encoding="utf-8")
    commit(repo_root(project))
    result = run_validator(project)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "old.md" not in result.stdout


def test_committed_content_is_validated(project: Path) -> None:
    """An uncommitted edit must not hide a malformed fragment at the PR head."""
    change_source(project)
    fragment = project / "changelog.d/new.md"
    fragment.write_text("", encoding="utf-8")
    commit(repo_root(project))
    fragment.write_text(VALID_FRAGMENT, encoding="utf-8")
    assert run_validator(project).returncode == 1


def test_explicit_head_ignores_checkout_changes(project: Path) -> None:
    """CI validates the PR head, even if a merge checkout adds a base fragment."""
    change_source(project)
    git(project, "branch", "pr-head")
    (project / "changelog.d/new.md").write_text(VALID_FRAGMENT, encoding="utf-8")
    commit(repo_root(project))
    result = run_validator(project, "--head-ref", "pr-head")
    assert result.returncode == 1


def test_ref_shell_syntax_remains_data(project: Path) -> None:
    """Untrusted ref text cannot execute shell commands."""
    marker = project / "injected"
    result = run_validator(project, "--base-ref", f"$(touch {marker})")
    assert result.returncode == 1
    assert not marker.exists()


def test_failed_diff_is_not_treated_as_empty(
    project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Git failures after ref verification still make the gate fail closed."""
    from scripts import validate_changeset

    original_run_git = validate_changeset.run_git

    def fail_comparison(root: Path, *args: str, verbose: bool = False) -> str:
        if args[0] == "diff":
            raise subprocess.CalledProcessError(
                128, ["git", "diff"], stderr="diff failed"
            )
        return original_run_git(root, *args, verbose=verbose)

    monkeypatch.setattr("scripts.validate_changeset.run_git", fail_comparison)
    monkeypatch.setattr(
        validate_changeset, "__file__", str(project / "scripts/validate_changeset.py")
    )
    assert validate_changeset.main(["--base-ref", "base", "--head-ref", "HEAD"]) == 1


def test_other_language_source_and_fragments_are_ignored(project: Path) -> None:
    """A multi-language Python gate considers only the Python project paths."""
    if project.name != "python":
        pytest.skip("Requires the multi-language layout")
    repo = repo_root(project)
    (repo / "src").mkdir()
    (repo / "src/code.py").write_text("value = 2\n", encoding="utf-8")
    commit(repo)
    assert run_validator(project).returncode == 0
    change_source(project)
    (repo / "changelog.d").mkdir()
    (repo / "changelog.d/new.md").write_text(VALID_FRAGMENT, encoding="utf-8")
    commit(repo)
    assert run_validator(project).returncode == 1
