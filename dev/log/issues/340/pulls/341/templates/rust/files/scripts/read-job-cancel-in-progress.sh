#!/usr/bin/env bash
# Print the effective concurrency.cancel-in-progress value for each named job.
# Values are true, false, none, missing, or unknown. Expressions outside the
# supported github.ref comparisons remain unknown (fail closed).
set -euo pipefail
: "${WORKFLOW_FILE:?WORKFLOW_FILE is required}"
# The single-quoted body is Python; GitHub expressions are parsed as data.
# shellcheck disable=SC2016
WORKFLOW_FILE="$WORKFLOW_FILE" JOB_NAMES="${JOB_NAMES:-}" python3 -c '
import os, re, sys
path = os.environ["WORKFLOW_FILE"]
names = [n for n in (sys.argv[1:] or os.environ["JOB_NAMES"].split("\n")) if n]
try:
    with open(path, encoding="utf-8") as handle: lines = handle.read().splitlines()
except OSError as exc:
    print("read-job-cancel-in-progress: %s" % exc, file=sys.stderr); sys.exit(1)
def indent_of(line): return len(line) - len(line.lstrip(" "))
def is_blank(line): return not line.strip() or line.strip().startswith("#")
def normalise(raw):
    raw = re.sub(r"\s+#.*$", "", raw).strip()
    if "${{" in raw:
        # Only the exact comparisons used by this template are supported.
        match = re.fullmatch(r"\$\{\{\s*github\.ref\s*(==|!=)\s*\x27([^\x27]*)\x27\s*\}\}", raw)
        ref = os.environ.get("GITHUB_REF", "")
        if not match or not ref: return "unknown"
        equal = ref.casefold() == match[2].casefold()
        return str(equal if match[1] == "==" else not equal).lower()
    raw = re.sub(r"\s+#.*$", "", raw).strip().strip("\x27\"").lower()
    return raw if raw in ("true", "false") else "unknown"
def read_concurrency(start, indent):
    rest = lines[start].split(":", 1)[1].strip()
    if rest and not rest.startswith("#"): return "false"
    value = None
    for line in lines[start + 1:]:
        if is_blank(line): continue
        if indent_of(line) <= indent: break
        found = re.match(r"\s*cancel-in-progress:\s*(.*)$", line)
        if found: value = found.group(1)
    return "false" if value is None else normalise(value)
workflow_level = None
for index, line in enumerate(lines):
    if re.match(r"^concurrency:", line):
        workflow_level = read_concurrency(index, 0); break
jobs = {}; in_jobs = False; current = None
for index, line in enumerate(lines):
    if re.match(r"^jobs:\s*$", line): in_jobs = True; continue
    if in_jobs and re.match(r"^[A-Za-z_]", line): break
    if not in_jobs or is_blank(line): continue
    declared = re.match(r"^  ([A-Za-z_][A-Za-z0-9_.-]*):", line)
    if declared:
        current = declared.group(1); jobs[current] = None; continue
    if current is not None and re.match(r"^    concurrency:", line):
        jobs[current] = read_concurrency(index, 4)
for name in names:
    if name not in jobs: answer = "missing"
    elif jobs[name] is not None: answer = jobs[name]
    elif workflow_level is not None: answer = workflow_level
    else: answer = "none"
    print("%s\t%s" % (name, answer))
' "$@"
