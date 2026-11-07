"""Repository-wide policies for the CI and release recovery issues in #98."""

from __future__ import annotations

import os
import re
import subprocess
import tomllib

import pytest

from tests.workflow_helpers import (
    ROOT,
    WORKFLOWS,
    read_workflow,
    workflow_job_block,
    workflow_run_blocks,
    workflow_step_block,
)


@pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.y*ml")))
def test_checkout_workflows_configure_git_before_any_job(path, tmp_path) -> None:
    """Every checkout must inherit the branch policy, including new workflows."""
    workflow = path.read_text()
    if "uses: actions/checkout@" not in workflow:
        return
    top_level = workflow.split("\njobs:\n", maxsplit=1)[0]
    expected = {
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "init.defaultBranch",
        "GIT_CONFIG_VALUE_0": "main",
    }
    for key, value in expected.items():
        assert re.search(rf"^  {key}: ['\"]?{re.escape(value)}['\"]?$", top_level, re.M)
    env = {**os.environ, **expected, "GIT_CONFIG_GLOBAL": "/dev/null"}
    result = subprocess.run(
        ["git", "init", str(tmp_path / "checkout")],
        env=env,
        capture_output=True,
        text=True,
        check=True,
        timeout=15,
    )
    assert "Using 'master'" not in result.stderr
    assert "refs/heads/main" in (tmp_path / "checkout" / ".git" / "HEAD").read_text()


@pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.y*ml")))
def test_no_workflow_expressions_are_interpolated_into_shell_code(path) -> None:
    """Step outputs and repository data must reach the shell as environment data."""
    for block in workflow_run_blocks(path.read_text()):
        assert "${{" not in block, f"{path.name}: {block}"


def test_zizmor_has_one_supported_version_and_checks_low_confidence() -> None:
    """The action, pedantic check and reproduction must use the same pin."""
    workflow = read_workflow("workflows.yml")
    job = workflow_job_block(workflow, "zizmor")
    assert "uses: zizmorcore/zizmor-action@v0.6.4" in job
    # Verified against v0.6.4's support/versions digest table.
    assert re.search(r"^  ZIZMOR_VERSION: ['\"]?1\.30\.1['\"]?$", workflow, re.M)
    assert "version: ${{ env.ZIZMOR_VERSION }}" in job
    assert workflow.count('pipx run "zizmor==$ZIZMOR_VERSION"') == 2
    assert "min-confidence: low" in job
    assert "--min-confidence low --persona regular" in workflow


def test_npx_scanners_are_exactly_pinned() -> None:
    """Reject floating npx -p packages in any workflow, including scoped names."""
    versions = {}
    for path in WORKFLOWS.glob("*.y*ml"):
        for block in workflow_run_blocks(path.read_text()):
            for package in re.findall(
                r"(?:-p|--package)\s+(\S+)", "\n".join(re.findall(r"npx[^\n]*", block))
            ):
                match = re.fullmatch(r"(.+)@(\d+\.\d+\.\d+)", package)
                assert match, f"{path.name}: unpinned npx package {package}"
                versions[match[1]] = match[2]
    assert (
        versions["secretlint"]
        == versions["@secretlint/secretlint-rule-preset-recommend"]
    )


@pytest.mark.parametrize("job_name", ["auto-release", "manual-release"])
def test_releases_can_resume_after_upload_or_tag_creation(job_name) -> None:
    """Both release paths must check artifacts, wait, smoke-test, then announce."""
    job = workflow_job_block(read_workflow("release.yml"), job_name)
    gate = workflow_step_block(job, "Check release artifacts")
    assert "scripts/check_release.py" in gate and " check " in gate
    assert 'git rev-parse "$TAG"' not in gate
    publish = workflow_step_block(job, "Publish to PyPI")
    assert "skip-existing: true" in publish
    steps = [
        "Publish to PyPI",
        "Wait for PyPI",
        "Smoke test published package",
        "Create GitHub Release",
    ]
    indices = [job.index(f"- name: {step}") for step in steps]
    assert indices == sorted(indices)
    for name in (
        ["Download artifacts"]
        if job_name == "auto-release"
        else ["Build package", "Check package"]
    ):
        assert (
            "steps.version_check.outputs.should_release == 'true'"
            in workflow_step_block(job, name)
        )
    for name in steps:
        assert (
            "steps.version_check.outputs.should_release == 'true'"
            in workflow_step_block(job, name)
        )
    wait = workflow_step_block(job, "Wait for PyPI")
    assert "scripts/check_release.py" in wait and " wait " in wait
    assert "timeout-minutes: 11" in wait
    smoke = workflow_step_block(job, "Smoke test published package")
    assert '--project-root "$PYTHON_ROOT"' in smoke


def test_local_publisher_also_allows_resuming_partial_uploads() -> None:
    """The standalone publishing entry point must have the same retry behavior."""
    script = (ROOT / "scripts" / "publish_to_pypi.py").read_text()
    assert '"--skip-existing"' in script


def test_codeql_ignores_experiments_in_both_python_layouts() -> None:
    """Filter the analysis itself rather than hiding whole workflow runs."""
    config = ROOT / ".github" / "codeql" / "codeql-config.yml"
    assert config.is_file()
    contents = config.read_text()
    assert "paths-ignore:" in contents
    for path in ("experiments", "python/experiments"):
        assert re.search(rf"^  - ['\"]?{re.escape(path)}['\"]?$", contents, re.M)
    job = workflow_job_block(read_workflow("security.yml"), "codeql")
    assert "config-file: ./.github/codeql/codeql-config.yml" in job
    assert "language: [python, actions]" in job


def test_lychee_throttles_github_without_accepting_failures() -> None:
    """Prevent bursts while keeping the existing 429/5xx recovery gate."""
    ignore = ROOT / ".lycheeignore"
    assert ignore.is_file()
    assert all(
        not line.strip() or line.lstrip().startswith("#")
        for line in ignore.read_text().splitlines()
    )
    config = tomllib.loads((ROOT / "lychee.toml").read_text())
    assert config["hosts"]["github.com"] == {"concurrency": 2, "request_interval": "1s"}
    assert "accept" not in config and "exclude" not in config
    workflow = read_workflow("links.yml")
    assert "--config lychee.toml" in workflow
    assert workflow.count("- 'lychee.toml'") == 2
    assert workflow.count("- '.lycheeignore'") == 2
