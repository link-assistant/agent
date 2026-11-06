#!/usr/bin/env bash
# Run a command under an execution budget that expires before the job clock.
# Usage: run-with-budget-warning.sh <budget-seconds> <label> <command> [args...]
#
# Environment:
#   BUDGET_WARN_RATIO_PERCENT  warn at this percentage of the budget (70)
#   BUDGET_ENFORCE             false warns without terminating (true)
#   BUDGET_GRACE_SECONDS       seconds between SIGTERM and SIGKILL (15)
#   BUDGET_KILL_SECONDS        seconds to wait after SIGKILL (5)
#   BUDGET_POLL_SECONDS        polling and output relay interval (1)
#   BUDGET_HEARTBEAT_SECONDS   verbose progress interval (60)
#   CI_VERBOSE                 true enables progress and signal tracing (false)
#   BUDGET_CAPTURE_OUTPUT      capture and relay private output files (1)
#   BUDGET_SUDO_KILL           use passwordless sudo for survivors (1)
#   BUDGET_STATE_PARENT        parent directory for private control files
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 SECONDS LABEL COMMAND [ARG...]" >&2
  exit 2
fi

budget_seconds="$1"
label="$2"
shift 2

case "$budget_seconds" in
  '' | *[!0-9]*)
    echo "Budget must be a whole number of seconds, got '${budget_seconds}'." >&2
    exit 2
    ;;
esac
[ "$budget_seconds" -gt 0 ] || {
  echo "Budget must be greater than zero seconds." >&2
  exit 2
}

warn_ratio="${BUDGET_WARN_RATIO_PERCENT:-70}"
enforce="${BUDGET_ENFORCE:-true}"
grace_seconds="${BUDGET_GRACE_SECONDS:-15}"
kill_seconds="${BUDGET_KILL_SECONDS:-5}"
poll_seconds="${BUDGET_POLL_SECONDS:-1}"
heartbeat_seconds="${BUDGET_HEARTBEAT_SECONDS:-60}"
capture_output="${BUDGET_CAPTURE_OUTPUT:-1}"
sudo_kill="${BUDGET_SUDO_KILL:-1}"
verbose="${CI_VERBOSE:-${BUDGET_VERBOSE:-false}}"
threshold=$((budget_seconds * warn_ratio / 100))
[ "$threshold" -gt 0 ] || threshold=1

case "$poll_seconds" in
  '' | *[!0-9.]* | *.*.*)
    echo "BUDGET_POLL_SECONDS must be a positive number, got: ${poll_seconds}" >&2
    exit 2
    ;;
esac

trace() {
  { [ "$verbose" = true ] || [ "$verbose" = 1 ]; } &&
    echo "[budget] $*" >&2 || true
}

state_parent="${BUDGET_STATE_PARENT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
if ! status_dir="$(mktemp -d "${state_parent%/}/budget-status.XXXXXX")"; then
  echo "Could not create budget control state under ${state_parent}." >&2
  exit 2
fi
status_file="${status_dir}/status"
stdout_file="${status_dir}/stdout"
stderr_file="${status_dir}/stderr"
trap 'rm -rf -- "$status_dir"' EXIT

if [ "$capture_output" = 1 ] || [ "$capture_output" = true ]; then
  capture_output=1
  : >"$stdout_file"
  : >"$stderr_file"
else
  capture_output=0
fi

stdout_offset=0
stderr_offset=0

stream_size() {
  local size
  size="$(wc -c <"$1" 2>/dev/null || echo 0)"
  size="${size//[![:digit:]]/}"
  echo "${size:-0}"
}

emit_range() {
  tail -c "+$(($2 + 1))" "$1" 2>/dev/null |
    head -c "$(($3 - $2))"
}

relay_output() {
  [ "$capture_output" = 1 ] || return 0
  local size
  size="$(stream_size "$stdout_file")"
  if [ "$size" -gt "$stdout_offset" ]; then
    emit_range "$stdout_file" "$stdout_offset" "$size" || true
    stdout_offset="$size"
  fi
  size="$(stream_size "$stderr_file")"
  if [ "$size" -gt "$stderr_offset" ]; then
    emit_range "$stderr_file" "$stderr_offset" "$size" >&2 || true
    stderr_offset="$size"
  fi
}

# The command gets a private process group and private output files. A worker
# that outlives the command root therefore cannot keep the CI step's pipe open.
# The atomically renamed status file distinguishes completion from a zombie.
set -m
if [ "$capture_output" = 1 ]; then
  {
    command_status=0
    "$@" || command_status=$?
    printf '%s\n' "$command_status" >"${status_file}.partial"
    mv "${status_file}.partial" "$status_file"
  } >"$stdout_file" 2>"$stderr_file" &
else
  {
    command_status=0
    "$@" || command_status=$?
    printf '%s\n' "$command_status" >"${status_file}.partial"
    mv "${status_file}.partial" "$status_file"
  } &
fi
command_pid=$!
set +m

have_ps=false
if ps -eo pgid=,pid=,stat= >/dev/null 2>&1; then
  have_ps=true
fi

# Process-table liveness separates an inaccessible live process (EPERM) from
# a missing process (ESRCH), while excluding zombies from active work.
group_members() {
  ps -eo pgid=,pid=,stat=,user=,args= 2>/dev/null |
    awk -v group="$command_pid" '$1 == group && $3 !~ /^Z/ {
      pid = $2; user = $4
      $1 = ""; $2 = ""; $3 = ""; $4 = ""
      sub(/^ +/, "")
      printf "%s %s %s\n", pid, user, $0
    }'
}

group_is_populated() {
  if [ "$have_ps" = true ]; then
    [ -n "$(group_members)" ]
  else
    kill -0 -- "-$command_pid" 2>/dev/null
  fi
}

sudo_kill_available=''
can_sudo_kill() {
  [ "$sudo_kill" = 1 ] || [ "$sudo_kill" = true ] || return 1
  if [ -z "$sudo_kill_available" ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      sudo_kill_available=yes
    else
      sudo_kill_available=no
    fi
  fi
  [ "$sudo_kill_available" = yes ]
}

signal_command_tree() {
  local signal="$1"
  kill "-$signal" -- "-$command_pid" 2>/dev/null ||
    kill "-$signal" "$command_pid" 2>/dev/null || true
  if group_is_populated && can_sudo_kill; then
    trace "survivors after SIG${signal}; retrying as root"
    sudo -n kill "-$signal" -- "-$command_pid" 2>/dev/null ||
      sudo -n kill "-$signal" "$command_pid" 2>/dev/null || true
  fi
}

# shellcheck disable=SC2329  # invoked indirectly by the trap below
forward_cancellation() {
  signal_command_tree TERM
}
trap forward_cancellation INT TERM

command_is_running() {
  [ -f "$status_file" ] && return 1
  group_is_populated
}

# SECONDS counts wall-clock second boundaries and can overread elapsed time
# by almost one second. Only a value strictly greater than the deadline proves
# the full budget (or signal grace period) has elapsed. Warnings may be early.
has_elapsed() {
  [ "$SECONDS" -gt "$1" ]
}

wait_while_running() {
  local deadline=$((SECONDS + $1))
  while group_is_populated && ! has_elapsed "$deadline"; do
    relay_output
    sleep "$poll_seconds"
  done
}

report_survivors() {
  [ "$have_ps" = true ] || return 0
  local survivors
  survivors="$(group_members)"
  [ -n "$survivors" ] || return 0
  echo "::error title=${label} left processes running::${label} could not be terminated. Still running: $(echo "$survivors" | tr '\n' ';')" >&2
  echo "$survivors" >&2
  return 1
}

terminate_over_budget() {
  echo "::error title=${label} exceeded its execution budget::Termination was requested after ${SECONDS}s, its full ${budget_seconds}s execution budget. The budget expires before \`timeout-minutes\` so this reports as a failure instead of a cancelled job." >&2
  signal_command_tree TERM
  wait_while_running "$grace_seconds"
  if group_is_populated; then
    echo "${label} ignored SIGTERM after ${grace_seconds}s; sending SIGKILL."
    signal_command_tree KILL
    wait_while_running "$kill_seconds"
  fi
  survivors=false
  report_survivors || survivors=true
  wait "$command_pid" 2>/dev/null || true
  relay_output
  if [ "$survivors" = true ]; then
    printf '%s still had live processes after its %ss execution budget.\n' \
      "$label" "$budget_seconds"
  else
    printf '%s was terminated after %ss, its full %ss execution budget.\n' \
      "$label" "$SECONDS" "$budget_seconds"
  fi
  exit 124
}

SECONDS=0
warned=false
last_heartbeat=0

while command_is_running; do
  if [ "$warned" = false ] && [ "$SECONDS" -ge "$threshold" ]; then
    warned=true
    echo "::warning title=${label} is approaching its timeout::The command is still running after ${SECONDS}s (${warn_ratio}% of its ${budget_seconds}s execution budget)." >&2
  fi
  if { [ "$verbose" = true ] || [ "$verbose" = 1 ]; } &&
    [ $((SECONDS - last_heartbeat)) -ge "$heartbeat_seconds" ]; then
    last_heartbeat="$SECONDS"
    echo "[budget] ${label} has been running for ${SECONDS}s of its ${budget_seconds}s budget." >&2
  fi
  if [ "$enforce" = true ] && has_elapsed "$budget_seconds"; then
    terminate_over_budget
  fi
  relay_output
  sleep "$poll_seconds"
done

wait_status=0
wait "$command_pid" 2>/dev/null || wait_status=$?
trap - INT TERM
relay_output

if [ -f "$status_file" ]; then
  status="$(cat "$status_file")"
else
  status="$wait_status"
fi
printf '%s took %ss of its %ss execution budget.\n' \
  "$label" "$SECONDS" "$budget_seconds"
exit "$status"
