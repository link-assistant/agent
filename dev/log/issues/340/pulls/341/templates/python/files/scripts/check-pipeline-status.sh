#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${NEEDS_JSON:-}" ]]; then
  echo "NEEDS_JSON must contain the workflow needs context" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH_NAME="${BRANCH_NAME:-${BRANCH_REF:-main}}"
HEAD_REF="${HEAD_REF:-${GITHUB_REF:-refs/heads/$BRANCH_NAME}}"
# A PR's merge ref is synthetic; the base repository's head ref tracks the
# actual contributor branch, including fork branches with colliding names.
if [[ "$HEAD_REF" == refs/pull/*/merge ]]; then
  HEAD_REF="${HEAD_REF%/merge}/head"
fi
GIT_REMOTE="${GIT_REMOTE:-origin}"

select_by_result() {
  local selection="$1"
  SELECTION="$selection" NEEDS_JSON="$NEEDS_JSON" python3 - <<'PY'
import json
import os

needs = json.loads(os.environ["NEEDS_JSON"])
selection = os.environ["SELECTION"]
for name, details in needs.items():
    result = (details or {}).get("result", "unknown")
    if selection == "cancelled" and result == "cancelled":
        print(name)
    elif selection == "failed" and result not in {"success", "skipped", "cancelled"}:
        print(name)
PY
}

join_names() {
  paste -sd, - | sed 's/,/, /g'
}

resolve_workflow_file() {
  if [[ -n "${WORKFLOW_FILE:-}" ]]; then
    printf '%s\n' "$WORKFLOW_FILE"
    return
  fi
  if [[ -n "${GITHUB_WORKFLOW_REF:-}" ]]; then
    local reference="${GITHUB_WORKFLOW_REF%@*}"
    local path="${reference#*/.github/}"
    [[ "$path" == "$reference" ]] && return 1
    reference="$path"
    printf '.github/%s\n' "$reference"
  fi
}

run_is_superseded() {
  local run_sha="${RUN_SHA:-${GITHUB_SHA:-}}"
  if [[ -z "$run_sha" || -z "$HEAD_REF" ]]; then
    return 1
  fi

  local branch_head="${BRANCH_HEAD_SHA:-}"
  if [[ -z "$branch_head" ]]; then
    branch_head="$(git ls-remote "$GIT_REMOTE" "$HEAD_REF" 2>/dev/null | awk 'NR == 1 {print $1}' || true)"
  fi
  [[ -n "$branch_head" && "$branch_head" != "$run_sha" ]]
}

failed_jobs="$(select_by_result failed)"
cancelled_jobs="$(select_by_result cancelled)"

if [[ -n "$failed_jobs" ]]; then
  echo "::error title=Pipeline failed::Failed jobs: $(printf '%s\n' "$failed_jobs" | join_names)"
fi

superseded_jobs=()
unexpected_jobs=()
unexpected_reasons=()

if [[ -n "$cancelled_jobs" ]]; then
  workflow_file="$(resolve_workflow_file)"
  superseded=false
  if run_is_superseded; then
    superseded=true
  fi

  declare -A cancellation_policy=()
  if [[ -n "$workflow_file" && -f "$workflow_file" ]]; then
    while IFS=$'\t' read -r job value; do
      cancellation_policy["$job"]="$value"
    done < <(
      WORKFLOW_FILE="$workflow_file" JOB_NAMES="$cancelled_jobs" \
        "$SCRIPT_DIR/read-job-cancel-in-progress.sh"
    )
  fi

  while IFS= read -r job; do
    [[ -z "$job" ]] && continue
    policy="${cancellation_policy[$job]:-unreadable}"
    if [[ "$superseded" == true && "$policy" == true ]]; then
      superseded_jobs+=("$job")
      continue
    fi

    unexpected_jobs+=("$job")
    if [[ "$superseded" != true ]]; then
      unexpected_reasons+=("$job: the run cannot be proven superseded by a newer branch head")
    else
      case "$policy" in
        false) reason="effective cancel-in-progress is false" ;;
        none) reason="no workflow or job cancel-in-progress policy is configured" ;;
        missing) reason="the job was not found in the active workflow" ;;
        unknown) reason="cancel-in-progress is dynamic and cannot be proven true" ;;
        *) reason="the active workflow cancellation policy could not be read" ;;
      esac
      unexpected_reasons+=("$job: $reason")
    fi
  done <<< "$cancelled_jobs"
fi

if (( ${#superseded_jobs[@]} > 0 )); then
  joined="$(printf '%s\n' "${superseded_jobs[@]}" | join_names)"
  echo "::warning title=Cancelled jobs in a superseded run::${joined}. This run is no longer the head of ${HEAD_REF} and these jobs cancel in progress."
fi

if (( ${#unexpected_jobs[@]} > 0 )); then
  for reason in "${unexpected_reasons[@]}"; do
    echo "  $reason"
  done
  joined="$(printf '%s\n' "${unexpected_jobs[@]}" | join_names)"
  echo "::error title=Pipeline has cancelled jobs::${joined}. No supersede accounts for these cancellations (see the reasons above)."
fi

if [[ -n "$failed_jobs" || ${#unexpected_jobs[@]} -gt 0 ]]; then
  exit 1
fi

echo "Pipeline passed."
