#!/usr/bin/env bash
# Read effective concurrency.cancel-in-progress values for named workflow jobs.
# Output: <job><TAB><true|false|none|missing|unknown>
set -euo pipefail

: "${WORKFLOW_FILE:?WORKFLOW_FILE is required}"

# Python reads literal GitHub expressions; the shell must not expand them.
# shellcheck disable=SC2016
WORKFLOW_FILE="$WORKFLOW_FILE" JOB_NAMES="${JOB_NAMES:-}" python3 -c '
import os
import re
import sys

path = os.environ["WORKFLOW_FILE"]
names = [name for name in (sys.argv[1:] or os.environ["JOB_NAMES"].split("\n")) if name]

try:
    with open(path, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
except OSError as exc:
    print("read-job-cancel-in-progress: %s" % exc, file=sys.stderr)
    sys.exit(1)


def indentation(line):
    return len(line) - len(line.lstrip(" "))


def is_blank(line):
    stripped = line.strip()
    return not stripped or stripped.startswith("#")


def normalise(raw):
    if "${{" in raw:
        return "unknown"
    raw = re.sub(r"\s+#.*$", "", raw).strip().strip("\x27\"").lower()
    if raw in ("true", "false"):
        return raw
    return "unknown"


def read_concurrency(start, indent):
    rest = lines[start].split(":", 1)[1].strip()
    if rest and not rest.startswith("#"):
        return "false"

    value = None
    for line in lines[start + 1:]:
        if is_blank(line):
            continue
        if indentation(line) <= indent:
            break
        found = re.match(r"\s*cancel-in-progress:\s*(.*)$", line)
        if found:
            value = found.group(1)
    return "false" if value is None else normalise(value)


workflow_level = None
for index, line in enumerate(lines):
    if re.match(r"^concurrency:", line):
        workflow_level = read_concurrency(index, 0)
        break

jobs = {}
in_jobs = False
current = None
for index, line in enumerate(lines):
    if re.match(r"^jobs:\s*$", line):
        in_jobs = True
        continue
    if in_jobs and re.match(r"^[A-Za-z_]", line):
        break
    if not in_jobs or is_blank(line):
        continue
    declared = re.match(r"^  ([A-Za-z_][A-Za-z0-9_.-]*):", line)
    if declared:
        current = declared.group(1)
        jobs[current] = None
        continue
    if current is not None and re.match(r"^    concurrency:", line):
        jobs[current] = read_concurrency(index, 4)

for name in names:
    if name not in jobs:
        answer = "missing"
    elif jobs[name] is not None:
        answer = jobs[name]
    elif workflow_level is not None:
        answer = workflow_level
    else:
        answer = "none"
    print("%s\t%s" % (name, answer))
' "$@"
