"""Shared parsers for the GitHub Actions workflow policy tests."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"

SUPPORTED_CONCURRENCY_KEYS = frozenset({"group", "cancel-in-progress", "queue"})

# The share of a job's `timeout-minutes` cap that its step deadlines may claim.
# The remainder pays for the work outside them -- checkout, Python setup, cache
# restore, artifact transfer -- plus the wrapper's SIGTERM grace. If the cap
# expires first, GitHub reports the kill as `cancelled` rather than `failure`
# and the overrun stops being visible on a pull request at all (issue #60).
MAX_BUDGET_SHARE_PERCENT = 70

STATUS_CHECK_FUNCTIONS = ("always()", "!cancelled()", "!failure()", "success()")


def read_workflow(name: str) -> str:
    """Read a workflow file by name."""
    return (WORKFLOWS / name).read_text(encoding="utf-8")


def workflow_job_block(workflow: str, job_name: str) -> str:
    """Return the YAML text block for one top-level workflow job."""
    lines = workflow.splitlines()
    start = next(index for index, line in enumerate(lines) if line == f"  {job_name}:")
    end = next(
        (
            index
            for index, line in enumerate(lines[start + 1 :], start + 1)
            if re.match(r"^  [A-Za-z0-9_-]+:$", line)
        ),
        len(lines),
    )
    return "\n".join(lines[start:end])


def workflow_step_block(job_block: str, step_name: str) -> str:
    """Return the YAML text block for one named workflow step."""
    lines = job_block.splitlines()
    start = next(
        index
        for index, line in enumerate(lines)
        if line.strip() == f"- name: {step_name}"
    )
    end = next(
        (
            index
            for index, line in enumerate(lines[start + 1 :], start + 1)
            if re.match(r"^      - ", line)
        ),
        len(lines),
    )
    return "\n".join(lines[start:end])


def workflow_run_blocks(workflow: str) -> list[str]:
    """Return every shell ``run:`` block from a workflow."""
    lines = workflow.splitlines()
    blocks: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        indentation = len(line) - len(line.lstrip())
        if not line.lstrip().startswith("run:"):
            index += 1
            continue

        block = [line]
        index += 1
        while index < len(lines):
            next_line = lines[index]
            next_indentation = len(next_line) - len(next_line.lstrip())
            if next_line.strip() and next_indentation <= indentation:
                break
            block.append(next_line)
            index += 1
        blocks.append("\n".join(block))

    return blocks


def workflow_job_names(workflow: str) -> list[str]:
    """Return every top-level job name declared by a workflow."""
    jobs_section = workflow.split("\njobs:\n", maxsplit=1)[1]
    return re.findall(r"^  ([A-Za-z0-9_-]+):$", jobs_section, re.MULTILINE)


def concurrency_keys(workflow: str) -> list[str]:
    """Return every key declared inside a ``concurrency:`` mapping."""
    lines = workflow.splitlines()
    keys: list[str] = []

    for index, line in enumerate(lines):
        header = re.match(r"^(\s*)concurrency:\s*$", line)
        if not header:
            continue

        block_indentation = len(header.group(1))
        key_indentation = block_indentation + 2
        for next_line in lines[index + 1 :]:
            if not next_line.strip() or next_line.lstrip().startswith("#"):
                continue
            indentation = len(next_line) - len(next_line.lstrip())
            if indentation <= block_indentation:
                break
            if indentation != key_indentation:
                continue
            key = re.match(r"([A-Za-z0-9_-]+):", next_line.lstrip())
            if key:
                keys.append(key.group(1))

    return keys


def assert_action_pin_count(
    workflow: str, action: str, version: str, count: int
) -> None:
    """Assert every expected action reference is pinned to the requested version."""
    pattern = rf"uses:\s+{re.escape(action)}@{re.escape(version)}\b"
    assert len(re.findall(pattern, workflow)) == count


def assert_action_pin_absent(workflow: str, action: str, version: str) -> None:
    """Assert an outdated action reference is not used."""
    pattern = rf"uses:\s+{re.escape(action)}@{re.escape(version)}\b"
    assert not re.search(pattern, workflow)


def assert_action_hash_pin(workflow: str, action: str, count: int) -> str:
    """Assert an action is pinned to a full commit hash annotated with its tag.

    zizmor's ``unpinned-uses`` audit demands a hash pin for every publisher not
    listed in ``.github/zizmor.yml``. A bare hash is unreadable, so the pin
    carries a ``# <tag> @ <date>`` comment that says what was pinned and when.
    """
    pattern = (
        rf"uses:\s+{re.escape(action)}@([0-9a-f]{{40}})"
        r"\s+#\s+(v[0-9][^\s]*) @ (\d{4}-\d{2}-\d{2})"
    )
    matches = re.findall(pattern, workflow)
    assert (
        len(matches) == count
    ), f"expected {count} hash-pinned {action} reference(s), found {len(matches)}"
    return matches[0][0]


def job_condition(workflow: str, job_name: str) -> str:
    """Return the ``if:`` condition text for a workflow job."""
    block = workflow_job_block(workflow, job_name)
    match = re.search(r"^    if:(.*?)(?=^    [a-z])", block, re.DOTALL | re.MULTILINE)
    assert match, f"job {job_name!r} has no if condition"
    return match.group(1)


def job_timeout_minutes(job_block: str) -> int | None:
    """Return the job-level ``timeout-minutes`` cap, if the job declares one."""
    match = re.search(r"^    timeout-minutes: (\d+)$", job_block, re.MULTILINE)
    return int(match.group(1)) if match else None


def job_step_deadline_seconds(job_block: str) -> list[tuple[str, int]]:
    """Return every step-level deadline in a job, as ``(source, seconds)``.

    A shell step owns its deadline through ``run-with-budget-warning.sh`` and a
    ``*_BUDGET_SECONDS`` env var; a step that runs a composite action cannot be
    wrapped, so it owns a step-level ``timeout-minutes`` instead.
    """
    budgets = [
        (name, int(seconds))
        for name, seconds in re.findall(
            r"^          ([A-Z0-9_]*BUDGET_SECONDS): (\d+)$", job_block, re.MULTILINE
        )
    ]
    step_timeouts = [
        (f"step timeout-minutes: {minutes}", int(minutes) * 60)
        for minutes in re.findall(
            r"^        timeout-minutes: (\d+)$", job_block, re.MULTILINE
        )
    ]
    return budgets + step_timeouts
