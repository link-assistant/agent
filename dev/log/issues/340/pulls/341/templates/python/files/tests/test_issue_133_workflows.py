"""Regression coverage for issues #130, #131 and #132 (umbrella issue #133)."""

from __future__ import annotations

import re
import subprocess

from tests.workflow_helpers import (
    ROOT,
    read_workflow,
    workflow_job_block,
    workflow_step_block,
)

DEPENDABOT = ROOT / ".github" / "dependabot.yml"


def _tracked_lockfile_dirs() -> set[str]:
    listed = subprocess.run(
        ["git", "ls-files", "--", ":(glob)**/package-lock.json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    ).stdout.split()
    return {"/" + path.rsplit("/", 1)[0] if "/" in path else "/" for path in listed}


# Issue #130 -----------------------------------------------------------------


def test_build_job_outputs_the_pages_artifact_id() -> None:
    build = workflow_job_block(read_workflow("docs.yml"), "build")
    assert "pages-artifact-id: ${{ steps.pages-artifact.outputs.artifact-id }}" in build
    upload = workflow_step_block(build, "Upload GitHub Pages artifact")
    assert "id: pages-artifact" in upload
    assert "pages: true" in upload


def test_deploy_job_publishes_exactly_that_artifact_with_retries() -> None:
    workflow = read_workflow("docs.yml")
    deploy = workflow_job_block(workflow, "deploy")
    step = workflow_step_block(deploy, "Deploy Pages artifact")
    assert "id: deployment" in step
    assert "uses: $/.github/actions/deploy-pages" in step
    assert "artifact_id: ${{ needs.build.outputs.pages-artifact-id }}" in step
    assert "url: ${{ steps.deployment.outputs.page_url }}" in deploy
    assert "id-token: write" in deploy
    assert "pages: write" in deploy
    assert "uses: actions/deploy-pages@" not in workflow


def test_deploy_action_declares_its_interface_and_has_no_dependencies() -> None:
    action_dir = ROOT / ".github" / "actions" / "deploy-pages"
    action = (action_dir / "action.yml").read_text(encoding="utf-8")
    assert "using: node24" in action
    assert "main: index.mjs" in action
    assert re.search(r"artifact_id:\n(?:    .*\n)*?    required: true", action)
    assert "default: ${{ github.token }}" in action
    assert "page_url:" in action
    assert not (action_dir / "package.json").exists()
    for source in action_dir.glob("*.mjs"):
        imports = re.findall(
            r"^import .* from '([^']+)';", source.read_text(encoding="utf-8"), re.M
        )
        assert all(
            name.startswith(("node:", "./")) for name in imports
        ), f"{source.name} imports {imports}"


def test_deploy_action_is_tested_and_linted() -> None:
    workflow = read_workflow("workflows.yml")
    job = workflow_job_block(workflow, "artifact-roundtrip")
    step = workflow_step_block(job, "Test Pages deployment retries and refusals")
    assert "node --throw-deprecation --test tests/deploy-pages.test.mjs" in step
    assert workflow.count("- 'tests/*.test.mjs'") == 2
    assert (ROOT / "tests" / "deploy-pages.test.mjs").is_file()
    config = (ROOT / ".github" / "actionlint.yaml").read_text(encoding="utf-8")
    assert r"\$/\.github/actions/(artifact|deploy-pages)" in config
    docs = read_workflow("docs.yml")
    assert docs.count("- '.github/actions/deploy-pages/**'") == 2


# Issue #131 -----------------------------------------------------------------


def test_link_checker_runs_weekly() -> None:
    workflow = read_workflow("links.yml")
    header = workflow.split("\njobs:\n")[0]
    assert re.search(r"^  schedule:\n    - cron: '0 6 \* \* 1'$", header, re.M)


def test_link_cache_key_is_scoped_to_the_utc_day() -> None:
    job = workflow_job_block(read_workflow("links.yml"), "link-checker")
    name = workflow_step_block(job, "Name today's link cache")
    assert "id: link-cache" in name
    assert 'echo "day=$(date -u +%F)" >> "$GITHUB_OUTPUT"' in name
    cache = workflow_step_block(job, "Restore lychee cache")
    day = "${{ steps.link-cache.outputs.day }}"
    assert f"key: cache-lychee-{day}-${{{{ github.sha }}}}" in cache
    # A restore prefix without the day would bring back yesterday's cache,
    # which lychee discards with "[WARN] Cache is too old".
    restore = re.findall(r"restore-keys: (.+)$", cache, re.M)
    assert restore == [f"cache-lychee-{day}-"]
    assert job.index("Name today's link cache") < job.index("Restore lychee cache")
    scan = workflow_step_block(job, "Check links with lychee")
    assert "--max-cache-age 1d" in scan


# Issue #132 -----------------------------------------------------------------


def test_security_workflow_audits_npm_lockfiles_and_gates_on_it() -> None:
    workflow = read_workflow("security.yml")
    job = workflow_job_block(workflow, "npm-audit")
    assert "timeout-minutes: 10" in job
    assert "persist-credentials: false" in job
    assert "uses: actions/setup-node@v7" in job
    step = workflow_step_block(job, "Audit every committed package-lock.json")
    assert "NPM_AUDIT_LEVEL: moderate" in step
    assert "bash scripts/audit-npm-locks.sh" in step
    assert "- npm-audit" in workflow_job_block(workflow, "pipeline-status")


def test_npm_audit_covers_every_tracked_lockfile() -> None:
    script = ROOT / "scripts" / "audit-npm-locks.sh"
    text = script.read_text(encoding="utf-8")
    assert "npm audit --package-lock-only" in text
    assert "NPM_AUDIT_LEVEL:-moderate" in text
    listed = subprocess.run(
        ["bash", str(script), "--list"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    ).stdout.split()
    tracked = _tracked_lockfile_dirs()
    assert tracked, "the artifact action's package-lock.json must be tracked"
    assert {"/" + p.rsplit("/", 1)[0] for p in listed} == tracked


def test_dependabot_updates_npm_and_actions_after_a_cooldown() -> None:
    config = DEPENDABOT.read_text(encoding="utf-8")
    assert re.search(r"^version: 2$", config, re.M)
    entries = re.split(r"^  - ", config.split("\nupdates:\n", 1)[1], flags=re.M)[1:]
    by_ecosystem: dict[str, list[str]] = {}
    for entry in entries:
        ecosystem = re.search(r"package-ecosystem: (\S+)", entry).group(1)
        directory = re.search(r"directory: (\S+)", entry).group(1)
        assert "interval: weekly" in entry, ecosystem
        assert re.search(r"cooldown:\n\s+default-days: 7", entry), ecosystem
        by_ecosystem.setdefault(ecosystem, []).append(directory)
    assert by_ecosystem["github-actions"] == ["/"]
    assert set(by_ecosystem["npm"]) == _tracked_lockfile_dirs()
    assert "/.github/actions/artifact" in by_ecosystem["npm"]


def test_stale_bundle_failure_tells_dependabot_reviewers_how_to_fix_it() -> None:
    job = workflow_job_block(read_workflow("workflows.yml"), "artifact-roundtrip")
    step = workflow_step_block(job, "Verify committed action bundle")
    assert "git diff --exit-code -- dist" in step
    assert "::error file=.github/actions/artifact/dist/index.mjs::" in step
    assert "npm run build --prefix .github/actions/artifact" in step
    assert "exit 1" in step
    for document in ("docs/ci-evidence.md", ".github/dependabot.yml"):
        assert "dist" in (ROOT / document).read_text(encoding="utf-8")


def test_artifact_lock_has_patched_glob_and_minimatch() -> None:
    lock = (ROOT / ".github/actions/artifact/package-lock.json").read_text(
        encoding="utf-8"
    )
    versions = {
        name: re.findall(
            rf'"node_modules/(?:[^"]+/node_modules/)?{name}": \{{\s*"version": "([^"]+)"',
            lock,
        )
        for name in ("glob", "minimatch")
    }

    def at_least(version: str, floor: tuple[int, ...]) -> bool:
        return tuple(int(part) for part in version.split(".")[:3]) >= floor

    # GHSA-3g3m-2fjr-6pw4 (glob < 14.0.2), GHSA-g3hv-75wg-m249 (minimatch < 11.0.1)
    assert versions["glob"] and all(at_least(v, (14, 0, 2)) for v in versions["glob"])
    assert versions["minimatch"] and all(
        at_least(v, (11, 0, 1)) for v in versions["minimatch"]
    )
