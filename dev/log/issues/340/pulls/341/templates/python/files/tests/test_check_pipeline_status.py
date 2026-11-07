"""Regression tests for per-job cancellation classification (issue #80)."""

from __future__ import annotations

import os
import json
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts" / "check-pipeline-status.sh"
READER = ROOT / "scripts" / "read-job-cancel-in-progress.sh"


def write_workflow(tmp_path: Path, jobs: str, workflow_concurrency: str = "") -> Path:
    """Write a minimal workflow fixture and return its path."""
    workflow = tmp_path / "fixture.yml"
    workflow.write_text(
        "name: Fixture\non: push\n" f"{workflow_concurrency}" "jobs:\n" f"{jobs}",
        encoding="utf-8",
    )
    return workflow


def read_values(workflow: Path, *jobs: str) -> dict[str, str]:
    """Read effective cancellation values from a workflow fixture."""
    completed = subprocess.run(
        ["bash", str(READER), *jobs],
        env={**os.environ, "WORKFLOW_FILE": str(workflow)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    return dict(line.split("\t", maxsplit=1) for line in completed.stdout.splitlines())


@pytest.mark.parametrize(
    ("declaration", "expected"),
    [
        ("concurrency:\n      group: build\n      cancel-in-progress: true", "true"),
        ("concurrency:\n      group: build\n      cancel-in-progress: false", "false"),
        ("concurrency:\n      group: build", "false"),
        ("concurrency: build", "false"),
        (
            "concurrency:\n      group: build\n"
            "      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
            "unknown",
        ),
        ("", "none"),
    ],
)
def test_reader_handles_every_job_level_value(
    tmp_path: Path, declaration: str, expected: str
) -> None:
    """Literal, default, absent, and expression values stay distinct."""
    indented = f"    {declaration}\n" if declaration else ""
    workflow = write_workflow(
        tmp_path,
        f"  build:\n{indented}    runs-on: ubuntu-24.04\n    steps: []\n",
    )

    values = read_values(workflow, "build", "renamed-job")

    assert values == {"build": expected, "renamed-job": "missing"}


def test_reader_uses_job_value_before_workflow_value(tmp_path: Path) -> None:
    """Job concurrency overrides the workflow-level fallback."""
    workflow = write_workflow(
        tmp_path,
        "  inherited:\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n"
        "  overridden:\n"
        "    concurrency:\n"
        "      group: overridden\n"
        "      cancel-in-progress: false\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n",
        "concurrency:\n  group: all\n  cancel-in-progress: true\n",
    )

    assert read_values(workflow, "inherited", "overridden") == {
        "inherited": "true",
        "overridden": "false",
    }


def run_gate(workflow: Path, **results: str) -> subprocess.CompletedProcess[str]:
    """Run the status gate as a provably superseded branch run."""
    needs = (
        "{"
        + ",".join(
            f'"{job}":{{"result":"{result}"}}' for job, result in results.items()
        )
        + "}"
    )
    return subprocess.run(
        ["bash", str(GATE)],
        cwd=ROOT,
        env={
            **os.environ,
            "NEEDS_JSON": needs,
            "RUN_SHA": "1" * 40,
            "BRANCH_HEAD_SHA": "2" * 40,
            "BRANCH_NAME": "feature",
            "WORKFLOW_FILE": str(workflow),
        },
        capture_output=True,
        text=True,
        check=False,
    )


def test_supersede_only_excuses_jobs_that_cancel_in_progress(tmp_path: Path) -> None:
    """A non-cancelling timeout stays red even beside a real supersede."""
    workflow = write_workflow(
        tmp_path,
        "  quick:\n"
        "    concurrency:\n"
        "      group: quick\n"
        "      cancel-in-progress: true\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n"
        "  publish:\n"
        "    concurrency:\n"
        "      group: publish\n"
        "      cancel-in-progress: false\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n",
    )

    completed = run_gate(workflow, quick="cancelled", publish="cancelled")

    assert completed.returncode == 1, completed.stdout
    assert "Cancelled jobs in a superseded run::" in completed.stdout
    assert "quick" in completed.stdout
    assert "Pipeline has cancelled jobs::publish" in completed.stdout
    assert "effective cancel-in-progress is false" in completed.stdout


@pytest.mark.parametrize(
    "jobs",
    [
        "  build:\n    runs-on: ubuntu-24.04\n    steps: []\n",
        "  build:\n"
        "    concurrency:\n"
        "      group: build\n"
        "      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n",
    ],
)
def test_absent_or_dynamic_concurrency_fails_closed(tmp_path: Path, jobs: str) -> None:
    """Only a known literal true may explain a cancellation."""
    completed = run_gate(write_workflow(tmp_path, jobs), build="cancelled")

    assert completed.returncode == 1, completed.stdout
    assert "Pipeline has cancelled jobs::build" in completed.stdout


def test_github_workflow_ref_resolves_the_active_file(tmp_path: Path) -> None:
    """The runner-provided workflow ref identifies the file without extra input."""
    checkout = tmp_path / "checkout"
    workflow_dir = checkout / ".github" / "workflows"
    workflow_dir.mkdir(parents=True)
    workflow = write_workflow(
        workflow_dir,
        "  build:\n"
        "    concurrency:\n"
        "      group: build\n"
        "      cancel-in-progress: false\n"
        "    runs-on: ubuntu-24.04\n"
        "    steps: []\n",
    )
    workflow.rename(workflow_dir / "ci.yml")
    completed = subprocess.run(
        ["bash", str(GATE)],
        cwd=checkout,
        env={
            **os.environ,
            "NEEDS_JSON": '{"build":{"result":"cancelled"}}',
            "RUN_SHA": "1" * 40,
            "BRANCH_HEAD_SHA": "2" * 40,
            "BRANCH_NAME": "feature",
            "GITHUB_WORKFLOW_REF": "owner/repo/.github/workflows/ci.yml@refs/pull/1/merge",
        },
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 1, completed.stdout
    assert "effective cancel-in-progress is false" in completed.stdout


@pytest.mark.parametrize("branch_name", ["main", "fork-only"])
@pytest.mark.parametrize(
    "ref_state", ["current", "superseded", "missing", "unreachable"]
)
def test_fork_cancellation_uses_exact_pr_head(tmp_path, branch_name, ref_state) -> None:
    """The base branch must never stand in for a fork's branch of the same name."""

    def git(*args):
        return subprocess.run(
            ["git", "-C", str(tmp_path), *args],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    git("init", "-q", "-b", "main")
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@e",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "base",
    )
    base = git("rev-parse", "HEAD")
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@e",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "fork",
    )
    fork = git("rev-parse", "HEAD")
    git("update-ref", "refs/heads/main", base)
    if ref_state not in {"missing", "unreachable"}:
        git("update-ref", "refs/pull/7/head", fork if ref_state == "current" else base)
    workflow = write_workflow(
        tmp_path,
        "  build:\n    concurrency:\n      group: check\n      cancel-in-progress: true\n    steps: []\n",
    )
    completed = subprocess.run(
        ["bash", str(GATE)],
        cwd=tmp_path,
        env={
            **os.environ,
            "NEEDS_JSON": json.dumps({"build": {"result": "cancelled"}}),
            "RUN_SHA": fork,
            "BRANCH_HEAD_SHA": "",
            "BRANCH_NAME": branch_name,
            "GIT_REMOTE": str(tmp_path / "missing")
            if ref_state == "unreachable"
            else str(tmp_path),
            "GITHUB_REF": "refs/pull/7/merge",
            "HEAD_REF": "refs/pull/7/head",
            "WORKFLOW_FILE": str(workflow),
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert completed.returncode == (0 if ref_state == "superseded" else 1), (
        completed.stdout + completed.stderr
    )
    if ref_state == "superseded":
        assert "Cancelled jobs in a superseded run" in completed.stdout
    else:
        assert "Pipeline has cancelled jobs" in completed.stdout
