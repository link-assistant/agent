#!/usr/bin/env bash
# Turn unexplained job failures and cancellations into a terminal red gate.
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
branch_name="${BRANCH_NAME:-main}"
git_remote="${GIT_REMOTE:-origin}"
# The base repository advertises refs/pull/N/head even for fork branches.
head_ref="${HEAD_REF:-refs/heads/${branch_name}}"
verbose="${PIPELINE_STATUS_VERBOSE:-0}"

trace() { [ "${verbose}" = "1" ] && echo "[pipeline-status] $*" >&2 || true; }

run_is_superseded() {
  local head="${BRANCH_HEAD_SHA:-}"

  if [ -z "${RUN_SHA:-}" ]; then
    echo "RUN_SHA is unset; cannot compare this run with the head of ${branch_name}; assuming it is current." >&2
    return 1
  fi
  if [ -z "${head}" ]; then
    head="$(git ls-remote "${git_remote}" "${head_ref}" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  fi
  if [ -z "${head}" ]; then
    echo "Could not resolve the head of ${branch_name}; assuming this run is current." >&2
    return 1
  fi

  echo "This run tests ${RUN_SHA}; ${branch_name} is at ${head}."
  [ "${head}" != "${RUN_SHA}" ]
}

select_by_result() {
  NEEDS_JSON="${NEEDS_JSON}" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const want = process.env.WANT_RESULT;
    const matches = (result) => want === "cancelled"
      ? result === "cancelled"
      : !["success", "skipped", "cancelled"].includes(result);
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

resolve_workflow_file() {
  local ref path
  if [ -n "${WORKFLOW_FILE:-}" ]; then
    printf '%s' "${WORKFLOW_FILE}"
    return 0
  fi
  ref="${GITHUB_WORKFLOW_REF:-}"
  [ -n "${ref}" ] || return 1
  ref="${ref%%@*}"
  path="${ref#*/.github/}"
  [ "${path}" != "${ref}" ] || return 1
  printf '.github/%s' "${path}"
}

# Print <job><TAB><supersede|overrun><TAB><reason>. A moved branch only
# explains a cancellation when this exact job can cancel in progress.
classify_cancellations() {
  local names="$1" superseded="$2" workflow reason name value policy_name policy_value
  local table=""

  workflow="$(resolve_workflow_file || true)"
  if [ -z "${workflow}" ]; then
    reason="the gate could not identify its workflow (GITHUB_WORKFLOW_REF is unset)"
  elif [ ! -f "${workflow}" ]; then
    reason="the gate could not read ${workflow} from this checkout"
  else
    reason=""
    table=""
    if ! table="$(WORKFLOW_FILE="${workflow}" JOB_NAMES="${names}" bash "${script_dir}/read-job-cancel-in-progress.sh" 2>&1)"; then
      reason="the gate could not read job concurrency from ${workflow}: ${table}"
      table=""
    fi
  fi

  while IFS= read -r name; do
    [ -z "${name}" ] && continue
    value="unreadable"
    while IFS=$'\t' read -r policy_name policy_value; do
      if [ "${policy_name}" = "${name}" ]; then
        value="${policy_value}"
        break
      fi
    done <<<"${table}"
    trace "cancelled ${name}: cancel-in-progress=${value}, superseded=${superseded}"

    if [ "${superseded}" != yes ]; then
      printf '%s\t%s\t%s\n' "${name}" overrun \
        "the run is still the head of ${branch_name}, so nothing overtook it"
      continue
    fi

    case "${value}" in
      true)
        printf '%s\t%s\t%s\n' "${name}" supersede \
          "it sets cancel-in-progress: true, so a supersede can cancel it"
        ;;
      false)
        printf '%s\t%s\t%s\n' "${name}" overrun \
          "it sets cancel-in-progress: false, so a supersede queues behind it"
        ;;
      none)
        printf '%s\t%s\t%s\n' "${name}" overrun \
          "it has no job- or workflow-level concurrency group"
        ;;
      missing)
        printf '%s\t%s\t%s\n' "${name}" overrun \
          "${workflow} declares no job by that name"
        ;;
      *)
        printf '%s\t%s\t%s\n' "${name}" overrun \
          "${reason:-its cancel-in-progress value is an expression or otherwise unreadable}"
        ;;
    esac
  done <<<"${names}"
}

# Jobs GitHub never started (no runner, no steps) are infrastructure, not
# code. The gate stays red, because nothing was tested, but names the cause.
# Reading the jobs needs GH_TOKEN with actions: read; JOBS_JSON replaces the
# request in tests.
report_unacquired_jobs() {
  local names errors
  if [ -z "${JOBS_JSON:-}" ] && { [ -z "${GH_TOKEN:-}" ] || [ -z "${GITHUB_RUN_ID:-}" ]; }; then
    trace "no GH_TOKEN or GITHUB_RUN_ID; not checking for unacquired runners"
    return 0
  fi
  errors="$(mktemp)"
  if ! names="$(node "${script_dir}/rerun-unacquired.mjs" report 2>"${errors}")"; then
    echo "::warning title=Runner acquisition unknown::Could not list the jobs of this run: $(tr '\n' ' ' <"${errors}")"
    rm -f "${errors}"
    return 0
  fi
  rm -f "${errors}"
  names="$(join_names "${names}")"
  [ -z "${names}" ] && return 0
  echo "::error title=Hosted runner not acquired::${names}. GitHub could not provide a runner, so no code ran. rerun-unacquired.yml reruns them automatically (at most twice); otherwise use Re-run failed jobs."
}

failed_lines="$(select_by_result not-success)"
cancelled_lines="$(select_by_result cancelled)"
failed="$(join_names "${failed_lines}")"
cancelled="$(join_names "${cancelled_lines}")"

echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"
status=0

if [ -n "${failed}" ]; then
  echo "::error title=Pipeline failed::Failing jobs: ${failed}"
  status=1
fi

if [ -n "${cancelled}" ]; then
  superseded=no
  if run_is_superseded; then superseded=yes; fi

  superseded_lines=""
  overrun_lines=""
  while IFS=$'\t' read -r job verdict reason; do
    [ -z "${job}" ] && continue
    echo "  ${job}: ${reason}"
    if [ "${verdict}" = supersede ]; then
      superseded_lines+="${job}"$'\n'
    else
      overrun_lines+="${job}"$'\n'
    fi
  done < <(classify_cancellations "${cancelled_lines}" "${superseded}")

  superseded_jobs="$(join_names "${superseded_lines}")"
  overrun_jobs="$(join_names "${overrun_lines}")"
  if [ -n "${superseded_jobs}" ]; then
    echo "::warning title=Cancelled jobs in a superseded run::${superseded_jobs}. This run is no longer the head of ${branch_name}, and these jobs cancel in progress."
  fi
  if [ -n "${overrun_jobs}" ]; then
    echo "::error title=Pipeline has cancelled jobs::${overrun_jobs}. No supersede accounts for these cancellations; timeout-minutes would otherwise leave the run grey."
    status=1
  fi
fi

if [ -n "${failed}${cancelled}" ]; then
  report_unacquired_jobs
fi

if [ "${status}" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "${status}"
