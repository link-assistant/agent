"""Regression tests for the release.yml job and step policy."""

from __future__ import annotations

import os
import re
import subprocess

from tests.workflow_helpers import (
    ROOT,
    STATUS_CHECK_FUNCTIONS,
    assert_action_hash_pin,
    assert_action_pin_absent,
    assert_action_pin_count,
    job_condition,
    read_workflow,
    workflow_job_block,
    workflow_run_blocks,
    workflow_step_block,
)


def test_changelog_check_safely_requires_a_fragment() -> None:
    """Source-changing pull requests must fail safely without a fragment."""
    workflow = read_workflow("release.yml")
    changelog_job = workflow_job_block(workflow, "changelog")
    check_step = workflow_step_block(changelog_job, "Check for changelog fragments")

    assert "fetch-depth: 0" in changelog_job
    assert "GITHUB_BASE_SHA: ${{ github.event.pull_request.base.sha }}" in check_step
    assert "GITHUB_HEAD_SHA: ${{ github.event.pull_request.head.sha }}" in check_step
    assert 'run: python "$PYTHON_ROOT/scripts/validate_changeset.py"' in check_step
    assert "find " not in check_step
    assert "Install scriv" not in changelog_job


def test_release_workflow_separates_check_and_write_concurrency() -> None:
    """Checks supersede off main while release writes share one group."""
    workflow = read_workflow("release.yml")
    workflow_header = workflow.split("\njobs:\n", maxsplit=1)[0]

    assert "\nconcurrency:\n" not in workflow_header

    for job_name in (
        "detect-changes",
        "lint",
        "test",
        "build",
        "changelog",
        "docker-build",
    ):
        block = workflow_job_block(workflow, job_name)
        expected_group = (
            "group: ${{ github.workflow }}-${{ github.ref }}-" f"{job_name}"
        )
        assert expected_group in block
        assert "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}" in block

    write_concurrency = "\n".join(
        (
            "    concurrency:",
            "      group: ${{ github.workflow }}-main-write",
            "      cancel-in-progress: false",
        )
    )
    for job_name in ("auto-release", "manual-release"):
        assert write_concurrency in workflow_job_block(workflow, job_name)


def test_release_workflow_uses_least_privilege_permissions() -> None:
    """Only publishing jobs should receive write-capable tokens."""
    workflow = read_workflow("release.yml")

    assert "\npermissions:\n  contents: read\n" in workflow

    for job_name in ("auto-release", "manual-release"):
        block = workflow_job_block(workflow, job_name)
        assert "permissions:\n      contents: write\n      id-token: write" in block


def test_release_workflow_jobs_have_explicit_timeouts() -> None:
    """Release workflow jobs should fail fast instead of using the six-hour default."""
    workflow = read_workflow("release.yml")

    expected_timeouts = {
        "detect-changes": 5,
        "lint": 20,
        "test": 30,
        "build": 20,
        "changelog": 10,
        "docker-build": 60,
        "auto-release": 30,
        "manual-release": 30,
        "pipeline-status": 5,
    }

    for job_name, timeout in expected_timeouts.items():
        block = workflow_job_block(workflow, job_name)
        assert f"timeout-minutes: {timeout}" in block


def test_pipeline_status_gate_covers_every_other_release_job() -> None:
    """Every release job must feed the terminal timeout/failure gate."""
    workflow = read_workflow("release.yml")
    jobs_section = workflow.split("\njobs:\n", maxsplit=1)[1]
    job_names = re.findall(r"^  ([A-Za-z0-9_-]+):$", jobs_section, re.MULTILINE)
    gate = workflow_job_block(workflow, "pipeline-status")

    assert "if: always()" in gate
    assert "run: bash scripts/check-pipeline-status.sh" in gate
    assert "NEEDS_JSON: ${{ toJSON(needs) }}" in gate
    assert "RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}" in gate
    assert "HEAD_REF:" in gate
    for job_name in job_names:
        if job_name != "pipeline-status":
            assert re.search(rf"(?:^|[\s,[])({re.escape(job_name)})(?=[\s,\]])", gate)


def test_pipeline_status_script_handles_all_job_conclusions() -> None:
    """The gate fails failures and only excuses configured supersedes."""
    script = ROOT / "scripts" / "check-pipeline-status.sh"
    text = script.read_text(encoding="utf-8")
    assert script.exists()
    assert "set -euo pipefail" in text
    assert "run_is_superseded" in text
    assert "git ls-remote" in text

    def run_gate(env: dict[str, str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(script)],
            cwd=ROOT,
            env={
                **os.environ,
                # Keep these subprocess fixtures hermetic when pytest itself
                # is running inside GitHub Actions.
                "GITHUB_WORKFLOW_REF": "",
                "WORKFLOW_FILE": "",
                "RUN_SHA": "",
                "GITHUB_SHA": "",
                "BRANCH_HEAD_SHA": "",
                "BRANCH_NAME": "",
                "BRANCH_REF": "",
                **env,
            },
            capture_output=True,
            text=True,
            check=False,
        )

    def needs_json(**results: str) -> str:
        return (
            "{"
            + ",".join(
                f'"{job}":{{"result":"{result}"}}' for job, result in results.items()
            )
            + "}"
        )

    healthy = run_gate({"NEEDS_JSON": needs_json(lint="success", test="skipped")})
    assert healthy.returncode == 0, healthy.stdout

    failed = run_gate({"NEEDS_JSON": needs_json(lint="failure")})
    assert failed.returncode == 1
    assert "::error title=Pipeline failed::" in failed.stdout

    # A cancellation is excused only when the run is superseded and the active
    # workflow gives that specific job a literal cancel-in-progress: true.
    superseded_ref = run_gate(
        {
            "NEEDS_JSON": needs_json(actionlint="cancelled"),
            "RUN_SHA": "1" * 40,
            "BRANCH_NAME": "feature",
            "BRANCH_HEAD_SHA": "2" * 40,
            "WORKFLOW_FILE": ".github/workflows/workflows.yml",
        }
    )
    assert superseded_ref.returncode == 0
    assert (
        "::warning title=Cancelled jobs in a superseded run::" in superseded_ref.stdout
    )

    # On main a cancellation is an overrun unless this run is provably behind
    # the branch head. An unprovable supersede fails loud (issue #69).
    unprovable = run_gate({"NEEDS_JSON": needs_json(auto_release="cancelled")})
    assert unprovable.returncode == 1
    assert "cannot be proven superseded" in unprovable.stdout

    at_head = run_gate(
        {
            "NEEDS_JSON": needs_json(test="cancelled"),
            "RUN_SHA": "1" * 40,
            "BRANCH_NAME": "main",
            "BRANCH_HEAD_SHA": "1" * 40,
            "WORKFLOW_FILE": ".github/workflows/workflows.yml",
        }
    )
    assert at_head.returncode == 1
    assert "::error title=Pipeline has cancelled jobs::" in at_head.stdout

    behind_head = run_gate(
        {
            "NEEDS_JSON": needs_json(actionlint="cancelled"),
            "RUN_SHA": "1" * 40,
            "BRANCH_NAME": "main",
            "BRANCH_HEAD_SHA": "2" * 40,
            "WORKFLOW_FILE": ".github/workflows/workflows.yml",
        }
    )
    assert behind_head.returncode == 0
    assert "Cancelled jobs in a superseded run" in behind_head.stdout


def test_release_workflow_action_versions_are_current() -> None:
    """Release workflow actions should use the current major versions."""
    release_workflow = read_workflow("release.yml")

    assert_action_pin_count(release_workflow, "actions/checkout", "v7", 13)
    assert_action_pin_count(release_workflow, "actions/setup-python", "v7", 7)
    assert release_workflow.count("uses: $/.github/actions/artifact") == 4
    assert release_workflow.count("operation: download") == 2
    assert_action_pin_absent(release_workflow, "actions/download-artifact", "v7")
    assert_action_hash_pin(release_workflow, "codecov/codecov-action", 1)
    assert_action_hash_pin(release_workflow, "pypa/gh-action-pypi-publish", 2)

    assert_action_pin_absent(release_workflow, "actions/setup-python", "v5")
    assert_action_pin_absent(release_workflow, "codecov/codecov-action", "v4")
    # A mutable branch pin executes whatever that branch holds at run time.
    assert_action_pin_absent(
        release_workflow, "pypa/gh-action-pypi-publish", "release/v1"
    )


def test_manual_release_collects_changelog_in_version_step() -> None:
    """Fragments must be collected after the numeric bump is calculated."""
    manual = workflow_job_block(read_workflow("release.yml"), "manual-release")
    assert "- name: Collect changelog fragments" not in manual
    assert 'scriv collect --version "$BUMP_TYPE"' not in manual
    assert "- name: Version and commit" in manual


def test_release_workflow_sets_git_default_branch_before_checkout() -> None:
    """Release workflow should suppress Git's default branch hint during checkout."""
    workflow = read_workflow("release.yml")

    assert "env:\n  GIT_CONFIG_COUNT: '1'" in workflow
    assert "  GIT_CONFIG_KEY_0: init.defaultBranch" in workflow
    assert "  GIT_CONFIG_VALUE_0: main" in workflow

    env_index = workflow.index("env:\n  GIT_CONFIG_COUNT: '1'")
    first_checkout_index = workflow.index("uses: actions/checkout@v7")
    assert env_index < first_checkout_index


def test_release_workflow_gates_codecov_upload_on_token() -> None:
    """Codecov uploads should be skipped without a token and fail loudly with one."""
    workflow = read_workflow("release.yml")
    test_job = workflow_job_block(workflow, "test")
    skip_step = workflow_step_block(test_job, "Report skipped Codecov upload")
    upload_step = workflow_step_block(test_job, "Upload coverage to Codecov")

    assert "CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}" in test_job
    assert "if: env.CODECOV_TOKEN == ''" in skip_step
    assert "::notice::" in skip_step
    assert "if: env.CODECOV_TOKEN != ''" in upload_step
    assert_action_hash_pin(upload_step, "codecov/codecov-action", 1)
    assert "files: ${{ steps.python_layout.outputs.root }}/coverage.xml" in upload_step
    assert "\n          file:" not in upload_step
    assert "token: ${{ env.CODECOV_TOKEN }}" in upload_step
    assert "disable_search: true" in upload_step
    assert "fail_ci_if_error: true" in upload_step
    assert "fail_ci_if_error: false" not in upload_step


def test_release_workflow_auto_detects_python_layout() -> None:
    """Release workflow should support root and python/ package layouts."""
    workflow = read_workflow("release.yml")

    assert "if [ -f pyproject.toml ]; then" in workflow
    assert "elif [ -f python/pyproject.toml ]; then" in workflow
    assert "root=python" in workflow
    assert "multi_language=true" in workflow


def test_release_workflow_namespaces_multi_language_python_tags() -> None:
    """Multi-language releases should use py_v tags and plain root releases keep v."""
    workflow = read_workflow("release.yml")
    auto_release = workflow_job_block(workflow, "auto-release")

    assert "scripts/check_release.py" in auto_release
    assert 'git rev-parse "$TAG"' not in auto_release
    # The shared helper's decision matrix tests verify v/py_v in both layouts.


def test_release_workflow_runs_python_steps_from_detected_root() -> None:
    """Package build and release commands should run against the detected root."""
    workflow = read_workflow("release.yml")

    assert 'cd "$PYTHON_ROOT"' in workflow
    assert 'echo "PYTHON_ROOT=$PYTHON_ROOT" >> "$GITHUB_ENV"' in workflow
    assert "path: ${{ steps.python_layout.outputs.dist_dir }}" in workflow
    assert "packages-dir: ${{ steps.python_layout.outputs.dist_dir }}" in workflow
    assert 'python "$PYTHON_ROOT/scripts/create_github_release.py"' in workflow


def test_dispatch_dependent_jobs_use_status_check_function() -> None:
    """Jobs that depend on skippable jobs must override the default status gate.

    ``detect-changes`` is skipped for ``workflow_dispatch``. GitHub Actions skips
    a job whose dependency was skipped unless the dependent ``if`` condition
    includes a status-check function (``always()``, ``!cancelled()``, ...).
    Without it, a manual release silently skips lint/test and then the release
    itself even though it appears successful.
    """
    workflow = read_workflow("release.yml")

    for job_name in ("lint", "test", "manual-release"):
        condition = job_condition(workflow, job_name)
        assert any(fn in condition for fn in STATUS_CHECK_FUNCTIONS), (
            f"job {job_name!r} depends on a skippable job but its if condition "
            f"does not start with a status-check function: {condition!r}"
        )


def test_release_workflow_propagates_cancellation() -> None:
    """Dependent jobs must stop when a workflow run is cancelled."""
    workflow = read_workflow("release.yml")

    assert "always() && !cancelled()" not in workflow
    for job_name in ("lint", "test", "build", "manual-release"):
        condition = job_condition(workflow, job_name)
        assert "!cancelled()" in condition
        assert "always()" not in condition


def test_change_gated_jobs_use_detector_for_pull_requests_and_pushes() -> None:
    """Automatic events must use the same authoritative detector output."""
    workflow = read_workflow("release.yml")

    for job_name in ("lint", "test", "build"):
        condition = job_condition(workflow, job_name)
        assert "needs.detect-changes.outputs.any-code-changed == 'true'" in condition
        assert "github.event_name == 'push'" not in condition
        assert "github.event_name == 'workflow_dispatch'" in condition


def test_manifest_versions_are_read_by_table_path_not_grep() -> None:
    """Version scrapes with grep/sed/awk/cut cannot see TOML tables (issue #67).

    A line-anchored scrape matches a ``version`` key in any table -- scriv's
    documented ``[tool.scriv] version``, for example -- so every pyproject.toml
    version read must go through scripts/read_manifest.py or tomllib.
    """
    for name in (
        "release.yml",
        "workflows.yml",
        "docs.yml",
        "links.yml",
        "security.yml",
    ):
        workflow = read_workflow(name)
        for block in workflow_run_blocks(workflow):
            commands = "\n".join(
                line for line in block.splitlines() if not line.lstrip().startswith("#")
            )
            if "pyproject.toml" not in commands or "version" not in commands:
                continue
            for scraper in ("grep ", "grep$", "sed ", "sed$", "awk ", "awk$", "cut "):
                assert scraper not in commands, (
                    f"{name}: scrape pyproject.toml version with "
                    f"scripts/read_manifest.py instead of {scraper.strip()}"
                )


def test_release_preflight_gates_every_publishing_job() -> None:
    """Nothing that writes to PyPI, GitHub, or Docker Hub may skip the
    credential preflight (issues #74 and #77)."""
    workflow = read_workflow("release.yml")
    preflight = workflow_job_block(workflow, "release-preflight")

    assert "bash scripts/preflight-credentials.sh" in preflight
    assert "timeout-minutes: 5" in preflight
    # The PyPI probe mints a trusted-publishing upload token, which needs OIDC.
    assert "id-token: write" in preflight
    assert "persist-credentials: false" in preflight

    for job_name in (
        "auto-release",
        "manual-release",
        "docker-publish-config",
        "docker-publish-build",
        "docker-publish",
    ):
        job = workflow_job_block(workflow, job_name)
        assert "release-preflight" in job, f"{job_name} must need release-preflight"
        assert (
            "needs.release-preflight.result == 'success'" in job
        ), f"{job_name} must gate on the preflight verdict, not just greenness"


def test_validate_docs_gates_on_docs_changes() -> None:
    """Docs-only PRs skip the changelog gate, so validate-docs must observe
    docs-changed and enforce the documentation contract (issue #72)."""
    workflow = read_workflow("release.yml")
    job = workflow_job_block(workflow, "validate-docs")

    assert "needs: [detect-changes]" in job
    assert "if: |" in job
    assert "github.event_name == 'workflow_dispatch'" in job
    assert "needs.detect-changes.outputs.docs-changed == 'true'" in job
    assert "bash scripts/check-required-docs.sh" in job
    assert "python scripts/check_file_size.py" in job
    assert "persist-credentials: false" in job
    assert "timeout-minutes:" in job


def test_detect_changes_only_exports_consumed_outputs() -> None:
    """Detector outputs should not drift from the workflow's actual job gates."""
    workflow = read_workflow("release.yml")
    block = workflow_job_block(workflow, "detect-changes")

    assert "any-code-changed:" in block
    assert "docs-changed:" in block
    assert "outputs.docs-changed == 'true'" in workflow
    for unused_output in (
        "py-changed",
        "tests-changed",
        "package-changed",
        "workflow-changed",
    ):
        assert f"{unused_output}:" not in block
        assert f"outputs.{unused_output}" not in workflow


def test_release_workflow_checks_fresh_merge_and_secrets() -> None:
    """Pull requests must test a fresh base merge and scan for secrets."""
    workflow = read_workflow("release.yml")
    lint = workflow_job_block(workflow, "lint")

    assert "fetch-depth: 0" in lint
    assert "- name: Simulate fresh merge with base branch (PR only)" in lint
    assert "if: github.event_name == 'pull_request'" in lint
    assert "BASE_REF: ${{ github.base_ref }}" in lint
    assert "run: bash scripts/simulate-fresh-merge.sh" in lint
    assert "- name: Check for secrets" in lint
    assert (
        "npx --yes -p secretlint@13.0.7 -p "
        '@secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint "**/*"' in lint
    )
    secretlint_config = (ROOT / ".secretlintrc.json").read_text(encoding="utf-8")
    assert '"id": "@secretlint/secretlint-rule-preset-recommend"' in secretlint_config


def test_release_workflow_builds_docker_images_on_pull_requests() -> None:
    """Docker regressions must fail before packages are published."""
    workflow = read_workflow("release.yml")
    block = workflow_job_block(workflow, "docker-build")

    assert "name: Docker Image Build Check" in block
    assert "needs: [detect-changes]" in block
    assert (
        "if: github.event_name == 'pull_request' && "
        "needs.detect-changes.outputs.any-code-changed == 'true'" in block
    )
    assert "uses: docker/setup-buildx-action@v4" in block
    assert "uses: docker/build-push-action@v7" in block
    assert "push: false" in block
    assert "load: true" in block
    assert "cache-from: type=gha,scope=docker-pr-check" in block
    assert "cache-to: type=gha,mode=max,scope=docker-pr-check" in block


def test_release_workflow_publishes_multi_arch_docker_images() -> None:
    """Released Docker images must use native amd64 and arm64 runners."""
    workflow = read_workflow("release.yml")
    config = workflow_job_block(workflow, "docker-publish-config")
    build = workflow_job_block(workflow, "docker-publish-build")
    publish = workflow_job_block(workflow, "docker-publish")

    assert "needs: [auto-release, manual-release, release-preflight]" in config
    assert "DOCKERHUB_IMAGE: ${{ vars.DOCKERHUB_IMAGE }}" in config
    assert "DOCKERHUB_USERNAME: ${{ vars.DOCKERHUB_USERNAME }}" in config
    assert "DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}" in config
    assert "if [ ! -f Dockerfile ]" in config

    assert "fail-fast: false" in build
    assert "platform: linux/amd64" in build
    assert "runner: ubuntu-24.04" in build
    assert "platform: linux/arm64" in build
    assert "runner: ubuntu-24.04-arm" in build
    assert "runs-on: ${{ matrix.runner }}" in build
    assert "platforms: ${{ matrix.platform }}" in build
    assert "cache-from: type=gha,scope=${{ matrix.platform }}" in build
    assert "cache-to: type=gha,mode=max,scope=${{ matrix.platform }}" in build
    assert "push-by-digest=true" in build
    assert "name-canonical=true" in build
    assert "uses: $/.github/actions/artifact" in build

    assert "uses: $/.github/actions/artifact" in publish
    assert "operation: download" in publish
    assert "merge-multiple: true" in publish
    assert "docker buildx imagetools create" in publish
    assert '--tag "${IMAGE}:latest"' in publish
    assert '--tag "${IMAGE}:${VERSION}"' in publish
    assert "docker buildx imagetools inspect" in publish
    assert 'grep -q "linux/amd64"' in publish
    assert 'grep -q "linux/arm64"' in publish
    assert "docker/setup-qemu-action" not in workflow


def test_docker_publish_follows_github_release_creation() -> None:
    """Image publication must only start after a GitHub release succeeds."""
    workflow = read_workflow("release.yml")
    config = workflow_job_block(workflow, "docker-publish-config")

    for release_job in ("auto-release", "manual-release"):
        block = workflow_job_block(workflow, release_job)
        assert "- name: Create GitHub Release" in block
        assert "released: ${{ steps.github_release.outputs.released }}" in block
        assert "version: ${{ steps.github_release.outputs.version }}" in block

    assert "needs.auto-release.outputs.released == 'true'" in config
    assert "needs.manual-release.outputs.released == 'true'" in config


def test_manual_release_requires_required_checks_to_succeed() -> None:
    """Manual release must only run after lint, test, and build succeed."""
    workflow = read_workflow("release.yml")
    condition = job_condition(workflow, "manual-release")

    assert "needs.lint.result == 'success'" in condition
    assert "needs.test.result == 'success'" in condition
    assert "needs.build.result == 'success'" in condition
    assert "github.event_name == 'workflow_dispatch'" in condition


def test_release_jobs_smoke_test_published_package_before_github_release() -> None:
    """Published packages must be installed and exercised before announcing release."""
    workflow = read_workflow("release.yml")

    expected_version_outputs = {
        "auto-release": "steps.version_check.outputs.current_version",
        "manual-release": "steps.version_check.outputs.current_version",
    }

    for job_name, version_output in expected_version_outputs.items():
        block = workflow_job_block(workflow, job_name)
        assert "- name: Smoke test published package" in block
        assert 'python "$PYTHON_ROOT/scripts/smoke_test_published_package.py"' in block
        assert f"RELEASE_VERSION: ${{{{ {version_output} }}}}" in block
        assert '--version "$RELEASE_VERSION"' in block

        publish_index = block.index("- name: Publish to PyPI")
        smoke_index = block.index("- name: Smoke test published package")
        release_index = block.index("- name: Create GitHub Release")
        assert publish_index < smoke_index < release_index


def test_long_release_steps_own_an_execution_deadline() -> None:
    """The steps whose duration a remote host decides must not run unbounded."""
    workflow = read_workflow("release.yml")

    wrapped = {
        "lint": ("Install dependencies", "Check for secrets"),
        "test": ("Install dependencies", "Run tests"),
    }
    for job_name, step_names in wrapped.items():
        block = workflow_job_block(workflow, job_name)
        for step_name in step_names:
            step = workflow_step_block(block, step_name)
            assert "run-with-budget-warning.sh" in step, (
                f"release.yml: step `{step_name}` of job `{job_name}` runs "
                "unbounded under the job clock (issue #60)"
            )
            assert re.search(r"^          [A-Z0-9_]*BUDGET_SECONDS: \d+$", step, re.M)

    # `uses:` steps cannot be wrapped by a shell script, so their deadline is a
    # step-level timeout-minutes -- which GitHub reports as a failed step.
    for job_name, step_name in (
        ("docker-build", "Build Docker image (no push)"),
        ("docker-publish-build", "Build and push platform image by digest"),
    ):
        block = workflow_job_block(workflow, job_name)
        step = workflow_step_block(block, step_name)
        assert re.search(r"^        timeout-minutes: \d+$", step, re.M), (
            f"release.yml: step `{step_name}` of job `{job_name}` has no "
            "step-level timeout, so an overrun cancels the job (issue #60)"
        )
