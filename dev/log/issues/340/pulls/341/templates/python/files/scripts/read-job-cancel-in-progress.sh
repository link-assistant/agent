#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${WORKFLOW_FILE:-}" ]]; then
  echo "WORKFLOW_FILE must name the active workflow" >&2
  exit 2
fi

python3 - "$WORKFLOW_FILE" "$@" <<'PY'
import os
import re
import sys
from pathlib import Path
from typing import Optional


def normalize(value: str) -> str:
    value = value.split("#", 1)[0].strip().strip("'\"").lower()
    if "${{" in value:
        return "unknown"
    if value in {"true", "false"}:
        return value
    return "unknown"


def concurrency_value(lines: list[str], start: int, indent: int) -> str:
    line = lines[start]
    remainder = line.split(":", 1)[1].strip()
    if remainder:
        # Scalar concurrency is a group name and has no cancel-in-progress key.
        return "false"

    index = start + 1
    while index < len(lines):
        candidate = lines[index]
        if not candidate.strip() or candidate.lstrip().startswith("#"):
            index += 1
            continue
        candidate_indent = len(candidate) - len(candidate.lstrip())
        if candidate_indent <= indent:
            break
        match = re.match(r"^\s*cancel-in-progress\s*:\s*(.*)$", candidate)
        if match:
            return normalize(match.group(1))
        index += 1
    return "false"


path = Path(sys.argv[1])
requested = sys.argv[2:]
if not requested:
    requested = [name for name in os.environ.get("JOB_NAMES", "").splitlines() if name]

try:
    lines = path.read_text(encoding="utf-8").splitlines()
except OSError as error:
    print(f"read-job-cancel-in-progress: {error}", file=sys.stderr)
    raise SystemExit(1) from error
workflow_value = "none"
jobs_start = len(lines)

for index, line in enumerate(lines):
    if re.match(r"^jobs\s*:\s*(?:#.*)?$", line):
        jobs_start = index
        break
    if re.match(r"^concurrency\s*:", line):
        workflow_value = concurrency_value(lines, index, 0)

job_values: dict[str, str] = {}
index = jobs_start + 1
while index < len(lines):
    line = lines[index]
    job_match = re.match(
        r"^  ([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(?:#.*)?$", line
    )
    if not job_match:
        index += 1
        continue

    job_name = job_match.group(1)
    job_value: Optional[str] = None
    index += 1
    while index < len(lines):
        child = lines[index]
        child_indent = len(child) - len(child.lstrip())
        if child.strip() and child_indent <= 2:
            break
        if re.match(r"^    concurrency\s*:", child):
            job_value = concurrency_value(lines, index, 4)
        index += 1
    job_values[job_name] = job_value if job_value is not None else workflow_value

for name in requested:
    print(f"{name}\t{job_values.get(name, 'missing')}")
PY
