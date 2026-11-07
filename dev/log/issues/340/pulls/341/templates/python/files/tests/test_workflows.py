"""Regression tests for GitHub Actions workflow policy."""

from __future__ import annotations

import re
import shlex
from pathlib import PurePosixPath

from tests.workflow_helpers import (
    MAX_BUDGET_SHARE_PERCENT,
    ROOT,
    SUPPORTED_CONCURRENCY_KEYS,
    WORKFLOWS,
    assert_action_pin_absent,
    assert_action_pin_count,
    concurrency_keys,
    job_step_deadline_seconds,
    job_timeout_minutes,
    read_workflow,
    workflow_job_block,
    workflow_job_names,
    workflow_run_blocks,
    workflow_step_block,
)


def test_workflow_run_blocks_do_not_interpolate_untrusted_inputs() -> None:
    """Contributor-controlled inputs must reach shell scripts through env vars."""
    unsafe_expression = re.compile(
        r"\$\{\{\s*(?:inputs\.|github\.event\.inputs\.|github\.(?:base|head)_ref)"
        r"[^}]*\}\}"
    )

    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = path.read_text(encoding="utf-8")
        for run_block in workflow_run_blocks(workflow):
            assert not unsafe_expression.search(run_block), (
                f"{path.name} interpolates an untrusted expression in a run block:\n"
                f"{run_block}"
            )


def test_security_workflow_scans_code_actions_and_dependencies() -> None:
    """Security checks must cover pushes, pull requests, and scheduled scans."""
    workflow = read_workflow("security.yml")
    codeql_job = workflow_job_block(workflow, "codeql")
    dependency_job = workflow_job_block(workflow, "dependency-review")
    audit_job = workflow_job_block(workflow, "dependency-audit")

    assert "branches: [main]" in workflow
    assert "pull_request:" in workflow
    assert "schedule:" in workflow
    assert "cron: '0 6 * * 1'" in workflow
    assert "permissions:\n  contents: read" in workflow

    assert "timeout-minutes: 30" in codeql_job
    assert "security-events: write" in codeql_job
    assert "language: [python, actions]" in codeql_job
    assert "languages: ${{ matrix.language }}" in codeql_job
    assert "uses: github/codeql-action/init@v4" in codeql_job
    assert "uses: github/codeql-action/autobuild@v4" in codeql_job
    assert "uses: github/codeql-action/analyze@v4" in codeql_job
    assert "cancel-in-progress: true" in codeql_job

    assert "if: github.event_name == 'pull_request'" in dependency_job
    assert "timeout-minutes: 10" in dependency_job
    assert "pull-requests: write" in dependency_job
    assert "uses: actions/dependency-review-action@v5" in dependency_job
    assert "fail-on-severity: high" in dependency_job
    assert "comment-summary-in-pr: on-failure" in dependency_job

    assert "timeout-minutes: 15" in audit_job
    assert "uses: actions/checkout@v7" in audit_job
    assert "uses: actions/setup-python@v7" in audit_job
    assert "python scripts/audit_dependencies.py" in audit_job
    assert "if: github.event_name == 'pull_request'" not in audit_job

    audit_script = (ROOT / "scripts" / "audit_dependencies.py").read_text(
        encoding="utf-8"
    )
    assert 'PIP_AUDIT_VERSION = "2.10.1"' in audit_script


def test_dependency_audit_maps_every_declared_surface() -> None:
    """Every dependency declaration in the template must be audited."""
    script = (ROOT / "scripts" / "audit_dependencies.py").read_text(encoding="utf-8")
    dependency_surfaces = [ROOT / "pyproject.toml", *ROOT.rglob("requirements*.txt")]

    assert dependency_surfaces
    for surface in dependency_surfaces:
        relative_surface = surface.relative_to(ROOT).as_posix()
        assert (
            relative_surface in script
        ), f"Dependency surface {relative_surface!r} has no audit mapping"


def test_links_workflow_fails_for_every_broken_live_link() -> None:
    """Archived snapshots must not make broken live links pass validation."""
    workflow = read_workflow("links.yml")
    link_job = workflow_job_block(workflow, "link-checker")
    lychee_step = workflow_step_block(link_job, "Check links with lychee")
    recheck_step = workflow_step_block(
        link_job, "Re-check transient and unanswered links"
    )
    archive_step = workflow_step_block(
        link_job, "Check broken links against Web Archive"
    )
    failure_step = workflow_step_block(link_job, "Fail if broken links were found")

    assert "- '**.md'" in workflow
    assert "- '**.html'" in workflow
    assert "scripts/recheck_broken_links.py" in workflow
    assert "scripts/check_web_archive.py" in workflow
    assert "permissions:\n  contents: read" in workflow
    assert "timeout-minutes: 10" in link_job
    assert "cancel-in-progress: true" in link_job
    assert "uses: actions/checkout@v7" in link_job
    assert "uses: lycheeverse/lychee-action@v2" in lychee_step
    assert "--exclude-path docs/case-studies" in lychee_step
    assert "examples/universal-app/index.html" not in lychee_step
    assert "fail: false" in lychee_step
    assert "output: lychee/out.md" in lychee_step
    # Issue #78: --max-retries cannot retry a connect-phase reset
    # (lycheeverse/lychee#2297), so unanswered failures are re-asked
    # outside lychee before anything is declared broken.
    assert "if: steps.lychee.outputs.exit_code != 0" in recheck_step
    assert "python scripts/recheck_broken_links.py" in recheck_step
    assert "RECOVERED_OUTPUT: lychee/recovered.txt" in recheck_step
    assert "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}" in recheck_step
    # `!= 'true'`, never `== 'false'`: a skipped re-check leaves the output
    # empty, and only the != form fails safe.
    assert "steps.lychee.outputs.exit_code != 0" in archive_step
    assert "steps.recheck.outputs.all_recovered != 'true'" in archive_step
    assert "python scripts/check_web_archive.py" in archive_step
    assert "RECOVERED_URLS: lychee/recovered.txt" in archive_step
    assert "always()" in failure_step
    assert "steps.lychee.outputs.exit_code != 0" in failure_step
    assert "steps.recheck.outputs.all_recovered != 'true'" in failure_step
    assert "all_archived" not in failure_step
    assert "exit 1" in failure_step


def test_every_workflow_has_a_terminal_status_gate() -> None:
    """A timeout outside release.yml must not vanish into a grey run (issue #69)."""
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = path.read_text(encoding="utf-8")
        jobs_section = workflow.split("\njobs:\n", maxsplit=1)[1]
        job_names = re.findall(r"^  ([A-Za-z0-9_-]+):$", jobs_section, re.MULTILINE)
        gate = workflow_job_block(workflow, "pipeline-status")

        assert "if: always()" in gate, f"{path.name} gate must run unconditionally"
        assert "run: bash scripts/check-pipeline-status.sh" in gate
        assert "NEEDS_JSON: ${{ toJSON(needs) }}" in gate
        assert (
            "RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}" in gate
        )
        assert "HEAD_REF:" in gate
        for job_name in job_names:
            if job_name == "pipeline-status":
                continue
            assert re.search(
                rf"(?:^|[\s,[])({re.escape(job_name)})(?=[\s,\]])", gate
            ), f"{path.name}: pipeline-status must observe {job_name}"


def test_every_gha_cache_export_carries_a_scope() -> None:
    """An unscoped GHA cache write lands in the shared `buildkit` scope.

    There the repository's builds overwrite each other, leaving only the final
    cache, and `mode=max` exports crowd the repository-wide 10 GB pool that
    actions/cache entries share (issue #66).
    """
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = path.read_text(encoding="utf-8")
        for line_number, line in enumerate(workflow.splitlines(), start=1):
            if "cache-to: type=gha" not in line:
                continue
            assert "scope=" in line, (
                f"{path.name}:{line_number} exports the GHA build cache without "
                "a scope; builds would overwrite each other's cache entries"
            )


def test_docs_workflow_action_versions_are_current() -> None:
    """Docs workflow actions should stay aligned with the current Pages stack."""
    docs_workflow = read_workflow("docs.yml")

    assert_action_pin_count(docs_workflow, "actions/checkout", "v7", 2)
    assert_action_pin_count(docs_workflow, "actions/setup-python", "v7", 1)
    assert docs_workflow.count("uses: $/.github/actions/artifact") == 2
    assert_action_pin_count(docs_workflow, "actions/configure-pages", "v6", 1)
    assert "pages: true" in docs_workflow
    # Issue #130: the local action replaces actions/deploy-pages@v5.
    assert docs_workflow.count("uses: $/.github/actions/deploy-pages") == 1
    assert "uses: actions/deploy-pages@" not in docs_workflow

    assert_action_pin_absent(docs_workflow, "actions/checkout", "v4")
    assert_action_pin_absent(docs_workflow, "actions/setup-python", "v5")
    assert_action_pin_absent(docs_workflow, "actions/upload-artifact", "v4")
    assert_action_pin_absent(docs_workflow, "actions/configure-pages", "v5")
    assert_action_pin_absent(docs_workflow, "actions/upload-pages-artifact", "v3")
    assert_action_pin_absent(docs_workflow, "actions/deploy-pages", "v4")


def test_docs_workflow_deploys_pages_only_when_opted_in() -> None:
    """Fresh repositories should build docs without failing Pages deployment."""
    workflow = read_workflow("docs.yml")
    build_job = workflow_job_block(workflow, "build")
    deploy_job = workflow_job_block(workflow, "deploy")
    configure_step = workflow_step_block(build_job, "Configure GitHub Pages")
    upload_step = workflow_step_block(build_job, "Upload GitHub Pages artifact")
    skip_step = workflow_step_block(build_job, "Report skipped GitHub Pages deployment")

    deploy_condition = (
        "github.event_name == 'push' && "
        "github.ref == 'refs/heads/main' && "
        "vars.DEPLOY_GITHUB_PAGES == 'true'"
    )
    skip_condition = (
        "github.event_name == 'push' && "
        "github.ref == 'refs/heads/main' && "
        "vars.DEPLOY_GITHUB_PAGES != 'true'"
    )

    assert f"if: {deploy_condition}" in configure_step
    assert f"if: {deploy_condition}" in upload_step
    assert f"if: {deploy_condition}" in deploy_job
    assert f"if: {skip_condition}" in skip_step
    assert "::notice::" in skip_step
    assert "DEPLOY_GITHUB_PAGES=true" in skip_step
    assert "Settings -> Pages" in skip_step


def test_every_workflow_job_declares_a_timeout() -> None:
    """A job with no cap inherits GitHub's six-hour default before cancelling."""
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = path.read_text(encoding="utf-8")
        for job_name in workflow_job_names(workflow):
            block = workflow_job_block(workflow, job_name)
            assert job_timeout_minutes(block) is not None, (
                f"{path.name}: job `{job_name}` declares no timeout-minutes, so it "
                "inherits the 360-minute default and concludes `cancelled`"
            )


def test_step_deadlines_expire_before_the_job_timeout_they_sit_under() -> None:
    """`timeout-minutes` is a backstop; the step deadlines must fire first."""
    checked = 0

    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = path.read_text(encoding="utf-8")
        for job_name in workflow_job_names(workflow):
            block = workflow_job_block(workflow, job_name)
            deadlines = job_step_deadline_seconds(block)
            if not deadlines:
                continue

            cap_minutes = job_timeout_minutes(block)
            assert (
                cap_minutes is not None
            ), f"{path.name}: job `{job_name}` budgets a step but declares no cap"
            checked += len(deadlines)

            cap_seconds = cap_minutes * 60
            total = sum(seconds for _, seconds in deadlines)
            share = total * 100 // cap_seconds
            assert share <= MAX_BUDGET_SHARE_PERCENT, (
                f"{path.name}: job `{job_name}` gives its steps {total}s of "
                f"deadlines ({dict(deadlines)}) under a {cap_minutes}m cap "
                f"({share}% of it). Unbudgeted setup has to fit in the remainder, "
                "or the job clock expires first and the overrun is reported as "
                "`cancelled` instead of `failure` (issue #60). Keep the total at "
                f"or below {MAX_BUDGET_SHARE_PERCENT}% of the cap."
            )

    assert checked >= 6, f"expected every budgeted step to be checked, saw {checked}"


def test_concurrency_key_parser_reports_unsupported_keys() -> None:
    """The scanner must report an unknown key alongside supported queue syntax."""
    invalid = "\n".join(
        (
            "jobs:",
            "  publish:",
            "    concurrency:",
            "      group: main-write",
            "      cancel-in-progress: false",
            "      queue: max",
            "      queue-size: 100",
            "    steps: []",
        )
    )

    assert concurrency_keys(invalid) == [
        "group",
        "cancel-in-progress",
        "queue",
        "queue-size",
    ]


def test_workflow_concurrency_blocks_use_only_supported_keys() -> None:
    """Documented concurrency keys include queue (issue #105)."""
    checked = 0

    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        keys = concurrency_keys(path.read_text(encoding="utf-8"))
        unsupported = sorted(set(keys) - SUPPORTED_CONCURRENCY_KEYS)
        assert not unsupported, (
            f"{path.name}: concurrency blocks declare {unsupported}, which "
            "are unsupported. Only "
            f"{sorted(SUPPORTED_CONCURRENCY_KEYS)} exist."
        )
        checked += len(keys)

    assert checked >= 2, f"expected concurrency blocks to be scanned, saw {checked}"


def test_workflow_lint_job_validates_every_workflow() -> None:
    """actionlint has to run in CI, or this class of defect goes unnoticed.

    It is what reports both halves of issue #62: the unsupported concurrency
    key, and (only when shellcheck is on PATH) the shell findings inside every
    ``run:`` block.
    """
    workflow = read_workflow("workflows.yml")
    job = workflow_job_block(workflow, "actionlint")

    assert "paths:" in workflow and "'.github/**'" in workflow
    assert "timeout-minutes:" in job
    # The Docker image bundles shellcheck and pyflakes; a bare binary without
    # shellcheck on PATH skips the shell checks and still exits 0.
    # Pinned by digest (issue #71): a mutable tag of a repository outside this
    # organization is arbitrary code in a job that analyses credentials.
    pin = re.search(
        r"uses:\s+docker://rhysd/actionlint@sha256:([0-9a-f]{64})\s+#\s+(v\S+)",
        job,
    )
    assert pin, "actionlint image must be digest-pinned with its tag in a comment"
    assert pin.group(2) == "v1.7.12"
    assert "docker://rhysd/actionlint:1.7" not in job


def test_workflow_audit_job_runs_zizmor() -> None:
    """zizmor has to run in CI next to actionlint, or its findings never surface.

    actionlint validates workflow schema and shell. It does not detect
    credential persistence, template injection or unpinned actions -- zizmor
    audits exactly those (issue #64).
    """
    workflow = read_workflow("workflows.yml")
    job = workflow_job_block(workflow, "zizmor")

    assert "paths:" in workflow and "'.github/**'" in workflow
    assert "timeout-minutes:" in job
    assert "uses: zizmorcore/zizmor-action@" in job
    assert "config: .github/zizmor.yml" in job
    assert "min-confidence: low" in job
    # SARIF upload needs code scanning, which forks of this template do not
    # necessarily have; annotations fail the job either way.
    assert "advanced-security: false" in job
    assert "annotations: true" in job
    # Both passes share an explicit version supported by the action.
    assert "version: ${{ env.ZIZMOR_VERSION }}" in job
    # The pedantic-only pass (issue #75): audits like `unpinned-images` do not
    # run in the regular persona, so a digest-pin regression in
    # `uses: docker://` would otherwise go unnoticed.
    assert "Audit for pedantic-only high-severity findings" in job
    assert 'pipx run "zizmor==$ZIZMOR_VERSION"' in job
    assert "--persona pedantic" in job
    assert "--min-severity high" in job
    assert "--min-confidence high" in job
    # The pedantic step owns a deadline of its own; the shared budget test
    # (test_step_deadlines_expire_before_the_job_timeout_they_sit_under) checks
    # it against the job cap.
    assert re.search(
        r"Audit for pedantic-only high-severity findings.*?^        timeout-minutes: \d+$",
        job,
        re.MULTILINE | re.DOTALL,
    )


def test_zizmor_reproduction_covers_dependabot() -> None:
    """The local regular scan must include Dependabot findings from CI (#102)."""
    workflow = read_workflow("workflows.yml")
    command = re.search(
        r"^  #   (pipx run[^\n]+)\\\n  #     ([^\n]+)$", workflow, re.MULTILINE
    )
    assert command, "missing local zizmor reproduction command"
    arguments = shlex.split(command.group(1) + command.group(2))
    scan_path = PurePosixPath(arguments[-1])
    dependabot_path = PurePosixPath(".github/dependabot.yml")

    assert (
        scan_path in dependabot_path.parents
    ), f"local scan of {scan_path} misses {dependabot_path}, which CI audits"


def test_zizmor_config_requires_hash_pins_by_default() -> None:
    """Unlisted publishers must be hash-pinned; trusted ones may stay tag-pinned."""
    config = (ROOT / ".github" / "zizmor.yml").read_text(encoding="utf-8")

    assert "unpinned-uses:" in config
    policies = dict(
        re.findall(r"^\s+'?([A-Za-z0-9_*/-]+)'?:\s*((?:hash|ref)-pin)$", config, re.M)
    )

    assert policies["*"] == "hash-pin"
    for publisher in ("actions/*", "github/*", "docker/*", "zizmorcore/*"):
        assert policies[publisher] == "ref-pin", publisher
    # Anything that publishes releases or artifacts is deliberately absent
    # here, so the catch-all hash-pin rule applies to it.
    assert not any(key.startswith(("pypa/", "codecov/")) for key in policies)


def test_every_checkout_declares_credential_persistence() -> None:
    """actions/checkout writes the token into .git/config unless told not to.

    Any later step in the same job can read it from there, so each checkout has
    to make the choice explicit rather than inherit the credential-persisting
    default (zizmor's ``artipacked`` audit).
    """
    checkouts = 0
    persisting: list[str] = []

    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if not re.match(r"^\s*- uses: actions/checkout@", line):
                continue
            checkouts += 1
            step = "\n".join(lines[index : index + 6])
            assert "persist-credentials:" in step, (
                f"{path.name}:{index + 1} checkout does not set " "persist-credentials"
            )
            if "persist-credentials: true" in step:
                persisting.append(f"{path.name}:{index + 1}")

    assert checkouts == 27, f"expected 27 checkouts, found {checkouts}"
    # Only the job that pushes the version bump commit needs the token wired
    # into the remote; every other checkout only reads the tree.
    assert (
        len(persisting) == 1
    ), f"only the pushing checkout may persist credentials, saw {persisting}"
    manual_release = workflow_job_block(read_workflow("release.yml"), "manual-release")
    assert "persist-credentials: true" in manual_release


def test_write_permissions_are_granted_per_job() -> None:
    """Workflow-level write scopes leak into every job, including read-only ones."""
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if line != "permissions:":
                continue
            for scope in lines[index + 1 :]:
                if not scope.startswith("  ") or not scope.strip():
                    break
                if scope.lstrip().startswith("#"):
                    continue
                assert scope.strip().endswith(("read", "none")), (
                    f"{path.name} grants '{scope.strip()}' to every job; move "
                    "write scopes to the jobs that need them"
                )
