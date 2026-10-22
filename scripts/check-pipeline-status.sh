#!/usr/bin/env bash
# check-pipeline-status.sh
#
# Turn failed, timed-out and unexplained cancelled jobs into a red run.
#
# GitHub reports a job killed by `timeout-minutes` as *cancelled*, not failed,
# and a workflow whose jobs were all cancelled or skipped still reports success.
# Every downstream job of this pipeline is gated on
# `needs.<job>.result == 'success'`, so a cancelled check silently skips the
# release instead of failing the run - a green pipeline that released nothing.
#
# A cancellation is accepted only when a newer run superseded this one (the
# head of the ref is no longer RUN_SHA) and the cancelled job's own
# `cancel-in-progress` lets a newer run cancel it. Any other cancellation,
# including a timeout on a pull request, fails the gate (issue #337).
#
# Usage (from a job with `if: always()` that needs every other job):
#   NEEDS_JSON='${{ toJSON(needs) }}' RUN_SHA=<sha> HEAD_REF=<git ref> \
#     bash scripts/check-pipeline-status.sh
#
# Environment:
#   NEEDS_JSON               toJSON(needs) (required)
#   RUN_SHA                  commit this run tests
#   HEAD_REF                 ref whose head tells whether the run is superseded
#                            (refs/pull/<n>/head for pull requests)
#   BRANCH_HEAD_SHA          head of HEAD_REF; looked up with git ls-remote when unset
#   GIT_REMOTE               remote to query (default: origin)
#   WORKFLOW_FILE            workflow to read job concurrency from; defaults to
#                            the file named by GITHUB_WORKFLOW_REF
#   GITHUB_REF               ref the `cancel-in-progress` expressions see
#   PIPELINE_STATUS_VERBOSE  1 to trace each decision (default: off)
#
# Exit code 0 = every job succeeded, was legitimately skipped, or was
# cancelled by a newer run.
#
# See https://github.com/link-assistant/agent/issues/301,
# https://github.com/link-assistant/agent/issues/337 and principle 5 of
# https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verbose="${PIPELINE_STATUS_VERBOSE:-0}"

trace() { if [ "${verbose}" = "1" ]; then echo "[pipeline-status] $*" >&2; fi; }

# Print the jobs whose result is $1, or every job that neither succeeded, was
# skipped nor was cancelled when $1 is "unsuccessful" (failure, timed_out, ...).
select_by_result() {
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const want = process.env.WANT_RESULT;
    const matches = (result) => want === "unsuccessful"
      ? !["success", "skipped", "cancelled"].includes(result)
      : result === want;
    for (const [name, value] of Object.entries(needs)) {
      if (matches(value?.result)) console.log(name);
    }
  '
}

join_names() {
  local result="" name
  while IFS= read -r name; do
    [ -z "${name}" ] && continue
    if [ -z "${result}" ]; then result="${name}"; else result="${result}, ${name}"; fi
  done <<<"$1"
  printf '%s' "${result}"
}

run_is_superseded() {
  local head="${BRANCH_HEAD_SHA:-}"

  if [ -z "${RUN_SHA:-}" ] || [ -z "${HEAD_REF:-}" ]; then
    echo "RUN_SHA or HEAD_REF is unset, so this run cannot be compared with a newer one; assuming it is current." >&2
    return 1
  fi
  if [ -z "${head}" ]; then
    head="$(git ls-remote "${GIT_REMOTE:-origin}" "${HEAD_REF}" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  fi
  if [ -z "${head}" ]; then
    echo "Could not resolve the head of ${HEAD_REF}; assuming this run is current." >&2
    return 1
  fi

  echo "This run tests ${RUN_SHA}; ${HEAD_REF} is at ${head}."
  [ "${head}" != "${RUN_SHA}" ]
}

workflow_file() {
  local ref="${GITHUB_WORKFLOW_REF:-}"
  if [ -n "${WORKFLOW_FILE:-}" ]; then
    printf '%s' "${WORKFLOW_FILE}"
  elif [ -n "${ref}" ] && [ "${ref#*/.github/}" != "${ref}" ]; then
    ref="${ref%%@*}"
    printf '.github/%s' "${ref#*/.github/}"
  fi
}

failed="$(join_names "$(select_by_result unsuccessful)")"
cancelled_lines="$(select_by_result cancelled)"
cancelled="$(join_names "${cancelled_lines}")"

echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"

status=0

if [ -n "$failed" ]; then
  echo "::error::Pipeline failed. Failing jobs: ${failed}"
  status=1
fi

if [ -n "$cancelled" ]; then
  superseded_lines=""
  if run_is_superseded; then
    workflow="$(workflow_file)"
    if [ -n "${workflow}" ] && [ -f "${workflow}" ]; then
      # shellcheck disable=SC2086 # job ids contain no whitespace
      superseded_lines="$(WORKFLOW_FILE="${workflow}" node "${script_dir}/job-cancel-policy.mjs" ${cancelled_lines})"
    else
      echo "Cannot read the workflow file (${workflow:-unknown}) to check which jobs cancel in progress." >&2
    fi
  fi
  trace "cancelled by a newer run: ${superseded_lines:-<none>}"

  unexplained_lines=""
  while IFS= read -r job; do
    [ -z "${job}" ] && continue
    if ! grep -qxF "${job}" <<<"${superseded_lines}"; then
      unexplained_lines+="${job}"$'\n'
    fi
  done <<<"${cancelled_lines}"

  superseded="$(join_names "${superseded_lines}")"
  unexplained="$(join_names "${unexplained_lines}")"
  if [ -n "${superseded}" ]; then
    echo "::warning::Cancelled jobs in a superseded run: ${superseded}. A newer run of ${HEAD_REF} replaced them."
  fi
  if [ -n "${unexplained}" ]; then
    echo "::error::Pipeline has cancelled jobs: ${unexplained}. No newer run replaced them; a job killed by 'timeout-minutes' is reported as cancelled, which would otherwise hide the failure."
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "$status"
