#!/usr/bin/env bash
# Terminal status gate. A cancellation is excused only when the run was
# superseded and that specific job has effective cancel-in-progress: true.
# Missing files, jobs, values, and unevaluated expressions fail closed.
set -euo pipefail
: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH_NAME="${BRANCH_NAME:-${BRANCH_REF:-main}}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
VERBOSE="${PIPELINE_STATUS_VERBOSE:-0}"
trace() { [ "$VERBOSE" = "1" ] && echo "[pipeline-status] $*" >&2 || true; }

run_is_superseded() {
  local head="${BRANCH_HEAD_SHA:-}" lookup_ref="${HEAD_REF:-refs/heads/${BRANCH_NAME}}"
  if [ -z "${RUN_SHA:-}" ]; then
    echo "RUN_SHA is unset; cannot prove this run was superseded." >&2; return 1
  fi
  if [ -z "$head" ]; then
    head="$(git ls-remote "$GIT_REMOTE" "$lookup_ref" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  fi
  if [ -z "$head" ]; then
    echo "Could not resolve the head of ${BRANCH_NAME}; cannot prove this run was superseded." >&2; return 1
  fi
  echo "This run tests ${RUN_SHA}; ${BRANCH_NAME} is at ${head}."
  [ "$head" != "$RUN_SHA" ]
}

select_by_result() {
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" python3 -c '
import json, os
needs = json.loads(os.environ["NEEDS_JSON"]); want = os.environ["WANT_RESULT"]
for name, value in needs.items():
    result = (value or {}).get("result")
    if (result == "cancelled") if want == "cancelled" else (result not in ("success", "skipped", "cancelled")):
        print(name)
'
}

join_names() {
  local out="" name
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    if [ -z "$out" ]; then out="$name"; else out="$out, $name"; fi
  done <<<"$1"
  printf '%s' "$out"
}

resolve_workflow_file() {
  local ref path
  if [ -n "${WORKFLOW_FILE:-}" ]; then printf '%s' "$WORKFLOW_FILE"; return; fi
  ref="${GITHUB_WORKFLOW_REF:-}"; [ -n "$ref" ] || return 1
  ref="${ref%%@*}"; path="${ref#*/.github/}"
  [ "$path" != "$ref" ] || return 1
  printf '.github/%s' "$path"
}

# Print: job<TAB>supersede|overrun<TAB>reason.
classify_cancellations() {
  local names="$1" superseded="$2" workflow reason name value table=""
  workflow="$(resolve_workflow_file || true)"
  if [ -z "$workflow" ]; then
    reason="the workflow file could not be resolved from GITHUB_WORKFLOW_REF"
  elif [ ! -f "$workflow" ]; then
    reason="the workflow file ${workflow} is unreadable"
  elif ! table="$(WORKFLOW_FILE="$workflow" JOB_NAMES="$names" bash "$SCRIPT_DIR/read-job-cancel-in-progress.sh" 2>&1)"; then
    reason="the workflow concurrency could not be read: ${table}"; table=""
  else
    reason=""
  fi
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    value="$(printf '%s\n' "$table" | awk -F '\t' -v job="$name" '$1 == job { print $2; exit }')"
    value="${value:-unreadable}"
    trace "${name}: cancel-in-progress=${value}, superseded=${superseded}"
    if [ "$superseded" != yes ]; then
      printf '%s\toverrun\tthe run is still current, so nothing overtook it\n' "$name"; continue
    fi
    case "$value" in
      true) printf '%s\tsupersede\tit sets cancel-in-progress: true\n' "$name" ;;
      false) printf '%s\toverrun\tit sets cancel-in-progress: false, so a supersede queues instead of cancelling it\n' "$name" ;;
      none) printf '%s\toverrun\tit has no concurrency group to cancel it\n' "$name" ;;
      missing) printf '%s\toverrun\tthe workflow declares no job by that name\n' "$name" ;;
      unknown) printf '%s\toverrun\tits cancel-in-progress value is an expression the gate cannot evaluate\n' "$name" ;;
      *) printf '%s\toverrun\t%s\n' "$name" "$reason" ;;
    esac
  done <<<"$names"
}

# Jobs GitHub never started (no runner, no steps, "not acquired" annotation) are
# infrastructure, not code (issue #226). They still fail the gate because nothing
# was tested, but the error names the cause. Best effort: needs GH_TOKEN with
# actions: read and checks: read; without it the gate behaves as before.
report_unacquired_jobs() {
  if [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_RUN_ID:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then
    trace "GH_TOKEN, GITHUB_RUN_ID or GITHUB_REPOSITORY unset; skipping the runner-acquisition check"
    return 0
  fi
  local names
  names="$(python3 "$SCRIPT_DIR/unacquired-jobs.py" list --repository "$GITHUB_REPOSITORY" \
    --run-id "$GITHUB_RUN_ID" --attempt "${GITHUB_RUN_ATTEMPT:-1}" || true)"
  [ -n "$names" ] || return 0
  echo "::error title=Hosted runner not acquired::$(join_names "$names"). GitHub could not provide a runner, so no code ran in these jobs; rerun-infrastructure-failures.yml reruns them automatically, or run: gh run rerun ${GITHUB_RUN_ID} --failed --repo ${GITHUB_REPOSITORY}"
}

[ "$VERBOSE" != "1" ] || trace "needs: $NEEDS_JSON"
failed_lines="$(select_by_result other)"; cancelled_lines="$(select_by_result cancelled)"
failed="$(join_names "$failed_lines")"; cancelled="$(join_names "$cancelled_lines")"
echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"
status=0
if [ -n "$failed" ]; then
  echo "::error title=Pipeline failed::Failing jobs: ${failed}"; status=1
fi
if [ -n "$failed" ] || [ -n "$cancelled" ]; then report_unacquired_jobs; fi
if [ -n "$cancelled" ]; then
  superseded=no; if run_is_superseded; then superseded=yes; fi
  superseded_lines=""; overrun_lines=""
  while IFS=$'\t' read -r job verdict reason; do
    [ -z "$job" ] && continue
    echo "  ${job}: ${reason}"
    if [ "$verdict" = supersede ]; then superseded_lines+="${job}"$'\n'; else overrun_lines+="${job}"$'\n'; fi
  done < <(classify_cancellations "$cancelled_lines" "$superseded")
  superseded_jobs="$(join_names "$superseded_lines")"; overrun_jobs="$(join_names "$overrun_lines")"
  if [ -n "$superseded_jobs" ]; then
    echo "::warning title=Cancelled jobs in a superseded run::${superseded_jobs}. These jobs set cancel-in-progress: true, so their cancellation is explained."
  fi
  if [ -n "$overrun_jobs" ]; then
    echo "::error title=Pipeline has cancelled jobs::${overrun_jobs}. No supersede accounts for these cancellations; inspect each for 'has exceeded the maximum execution time'."
    status=1
  fi
fi
[ "$status" -ne 0 ] || echo "All required jobs succeeded or were legitimately skipped."
exit "$status"
