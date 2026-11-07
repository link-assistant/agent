"""Regression coverage for the pipeline requirements in issues 104–117."""

from __future__ import annotations

import re

import pytest

from tests.workflow_helpers import (
    ROOT,
    WORKFLOWS,
    job_condition,
    read_workflow,
    workflow_job_block,
    workflow_step_block,
)


def test_dependabot_identity_reaches_fragment_validator() -> None:
    job = workflow_job_block(read_workflow("release.yml"), "changelog")
    step = workflow_step_block(job, "Check for changelog fragments")
    assert "PR_AUTHOR: ${{ github.event.pull_request.user.login }}" in step


def test_writers_queue_without_cancelling_pending_releases() -> None:
    for name in ("auto-release", "manual-release"):
        job = workflow_job_block(read_workflow("release.yml"), name)
        assert "queue: max" in job
        assert "cancel-in-progress: false" in job
    config = (ROOT / ".github/actionlint.yaml").read_text()
    assert 'unexpected key "queue" for "concurrency" section' in config
    assert "queue-size" not in config


@pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.yml")))
def test_first_party_checkout_and_python_actions_use_v7(path) -> None:
    workflow = path.read_text()
    for action in ("checkout", "setup-python"):
        pins = re.findall(rf"uses: actions/{action}@([^\s]+)", workflow)
        assert all(pin == "v7" for pin in pins)


def test_link_scan_uses_directory_extensions_and_persists_cache() -> None:
    job = workflow_job_block(read_workflow("links.yml"), "link-checker")
    scan = workflow_step_block(job, "Check links with lychee")
    assert "--extensions md,html" in scan
    assert "--hidden" in scan
    assert "--exclude-path scripts/fixtures" in scan
    assert "'./**/*.html'" not in scan
    assert re.search(r"^            \.$", scan, re.MULTILINE)
    assert "uses: actions/cache@v5" in job
    assert "path: .lycheecache" in job
    # Issue #131: scoped to the UTC day so a restored cache is never too old.
    day = "${{ steps.link-cache.outputs.day }}"
    assert f"key: cache-lychee-{day}-${{{{ github.sha }}}}" in job
    assert f"restore-keys: cache-lychee-{day}-" in job
    report = workflow_step_block(job, "Upload lychee report")
    assert "if: failure()" in report
    assert "name: lychee-report" in report
    assert "path: lychee/out.md" in report


def test_pedantic_workflow_audit_is_online() -> None:
    job = workflow_job_block(read_workflow("workflows.yml"), "zizmor")
    step = workflow_step_block(job, "Audit for pedantic-only high-severity findings")
    assert "GH_TOKEN: ${{ github.token }}" in step
    assert "--offline" not in step
    assert "contents: read" in job


def test_every_artifact_upload_fails_when_it_finds_no_files() -> None:
    for path in WORKFLOWS.glob("*.yml"):
        for step in re.split(r"^      - ", path.read_text(), flags=re.MULTILINE):
            if (
                "uses: $/.github/actions/artifact" in step
                and "operation: download" not in step
            ):
                assert "if-no-files-found: error" in step, (path.name, step)


def test_dependency_review_checks_graph_on_every_security_event() -> None:
    job = workflow_job_block(read_workflow("security.yml"), "dependency-review")
    assert "\n    if:" not in job
    assert "bash scripts/check-dependency-graph.sh" in job
    assert "GH_TOKEN: ${{ github.token }}" in job
    review = workflow_step_block(job, "Review dependency changes")
    assert "github.event_name == 'pull_request'" in review
    assert "steps.graph.outputs.enabled == 'true'" in review
    assert "continue-on-error" not in job


@pytest.mark.parametrize("name", ["auto-release", "manual-release"])
def test_release_waits_for_all_required_checks(name: str) -> None:
    workflow = read_workflow("release.yml")
    job = workflow_job_block(workflow, name)
    needs = re.search(r"needs: \[([^]]+)\]", job).group(1).split(",")
    assert set(map(str.strip, needs)) == {
        "lint",
        "test",
        "build",
        "release-preflight",
        "validate-docs",
        "changelog",
        "docker-build",
    }
    condition = job_condition(workflow, name)
    assert "!contains(needs.*.result, 'failure')" in condition
    assert "!contains(needs.*.result, 'cancelled')" in condition
    for required in ("lint", "test", "build", "release-preflight"):
        assert f"needs.{required}.result == 'success'" in condition


def test_required_dispatch_inputs_have_defaults() -> None:
    for path in WORKFLOWS.glob("*.yml"):
        header = path.read_text().split("\njobs:\n")[0]
        for block in re.split(r"^      \w+:\s*$", header, flags=re.MULTILINE)[1:]:
            if "required: true" in block:
                assert "default:" in block, path.name


def test_pages_deploy_needs_no_deprecation_warning_suppression() -> None:
    """Issue #130 removed deploy-pages v5 and with it the DEP0040 workaround."""
    workflow = read_workflow("docs.yml")
    step = workflow_step_block(
        workflow_job_block(workflow, "deploy"), "Deploy Pages artifact"
    )
    assert "uses: $/.github/actions/deploy-pages" in step
    assert "NODE_OPTIONS" not in workflow
    assert "DEP0040" not in workflow


def test_standalone_shellcheck_is_pinned_and_required() -> None:
    workflow = read_workflow("workflows.yml")
    assert workflow.count("- '**.sh'") == 2
    job = workflow_job_block(workflow, "shellcheck")
    assert "git ls-files -z '*.sh'" in job
    assert "shellcheck-py==0.11.0.1 shellcheck" in job
    assert "shellcheck" in workflow_job_block(workflow, "pipeline-status")
    hooks = (ROOT / ".pre-commit-config.yaml").read_text()
    assert "repo: https://github.com/shellcheck-py/shellcheck-py" in hooks
    assert "rev: v0.11.0.1" in hooks


@pytest.mark.parametrize("path", sorted(WORKFLOWS.glob("*.yml")))
def test_cancellation_gate_uses_the_base_repository_pr_head_ref(path) -> None:
    gate = workflow_job_block(path.read_text(), "pipeline-status")
    assert "RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}" in gate
    assert "HEAD_REF:" in gate
    assert "format('refs/pull/{0}/head', github.event.pull_request.number)" in gate
    assert "|| github.ref" in gate
