#!/usr/bin/env bash
# Run a command under a deadline that expires before the job timeout. Output is
# captured and relayed so an escaped descendant cannot retain the caller's pipe.
# Process-table liveness distinguishes root-owned survivors from absent tasks.
set -uo pipefail

usage() { echo "usage: $0 <budget_seconds> <label> <command> [args...]" >&2; exit 2; }
[ "$#" -ge 3 ] || usage
budget_seconds="$1"; label="$2"; shift 2

positive_integer() {
  case "$2" in '' | *[!0-9]*) echo "$1 must be a positive integer, got: ${2:-<unset>}" >&2; usage;; esac
  [ "$2" -gt 0 ] || { echo "$1 must be greater than zero, got: $2" >&2; usage; }
}
nonnegative_integer() {
  case "$2" in '' | *[!0-9]*) echo "$1 must be a non-negative integer, got: ${2:-<unset>}" >&2; usage;; esac
}
boolean() {
  case "$2" in 0 | 1) ;; *) echo "$1 must be 0 or 1, got: ${2:-<unset>}" >&2; usage;; esac
}

warn_percent="${BUDGET_WARN_PERCENT:-70}"
grace_seconds="${BUDGET_GRACE_SECONDS:-10}"
kill_seconds="${BUDGET_KILL_SECONDS:-5}"
poll_seconds="${BUDGET_POLL_SECONDS:-1}"
capture_output="${BUDGET_CAPTURE_OUTPUT:-1}"
sudo_kill="${BUDGET_SUDO_KILL:-1}"
verbose="${BUDGET_VERBOSE:-0}"
positive_integer budget "$budget_seconds"
nonnegative_integer BUDGET_WARN_PERCENT "$warn_percent"
nonnegative_integer BUDGET_GRACE_SECONDS "$grace_seconds"
nonnegative_integer BUDGET_KILL_SECONDS "$kill_seconds"
boolean BUDGET_CAPTURE_OUTPUT "$capture_output"
boolean BUDGET_SUDO_KILL "$sudo_kill"
boolean BUDGET_VERBOSE "$verbose"
case "$poll_seconds" in
  '' | *[!0-9.]* | *.*.* | . | .* | *.)
    echo "BUDGET_POLL_SECONDS must be a positive number, got: ${poll_seconds}" >&2; usage;;
esac
case "$poll_seconds" in *[1-9]*) ;; *) echo "BUDGET_POLL_SECONDS must be greater than zero" >&2; usage;; esac
warn_seconds=$((budget_seconds * warn_percent / 100))
trace() { [ "$verbose" = 1 ] && echo "[budget] $*" >&2 || true; }

state_parent="${BUDGET_STATE_PARENT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
if ! status_dir="$(mktemp -d "${state_parent%/}/budget-status.XXXXXX")"; then
  echo "Could not create budget control state under ${state_parent}." >&2; exit 2
fi
status_file="${status_dir}/status"; stdout_file="${status_dir}/stdout"; stderr_file="${status_dir}/stderr"
# Invoked by the EXIT trap.
# shellcheck disable=SC2329
cleanup() { rm -rf -- "$status_dir"; }
trap cleanup EXIT
trace "control state: ${status_dir}"

if [ "$capture_output" = 1 ]; then : >"$stdout_file"; : >"$stderr_file"; fi
stdout_offset=0; stderr_offset=0
stream_size() {
  local size
  size="$(wc -c <"$1" 2>/dev/null || echo 0)"; size="${size//[![:digit:]]/}"
  echo "${size:-0}"
}
emit_range() { tail -c "+$(($2 + 1))" "$1" 2>/dev/null | head -c "$(($3 - $2))"; }
relay_output() {
  [ "$capture_output" = 1 ] || return 0
  local size
  size="$(stream_size "$stdout_file")"
  if [ "$size" -gt "$stdout_offset" ]; then emit_range "$stdout_file" "$stdout_offset" "$size"; stdout_offset="$size"; fi
  size="$(stream_size "$stderr_file")"
  if [ "$size" -gt "$stderr_offset" ]; then emit_range "$stderr_file" "$stderr_offset" "$size" >&2; stderr_offset="$size"; fi
}

# The subshell owns the process group and writes completion atomically. A root
# command that exits while a worker survives therefore cannot fake completion.
set -m
if [ "$capture_output" = 1 ]; then
  { "$@"; command_status=$?; printf '%s\n' "$command_status" >"${status_file}.partial"; mv "${status_file}.partial" "$status_file"; } >"$stdout_file" 2>"$stderr_file" &
else
  { "$@"; command_status=$?; printf '%s\n' "$command_status" >"${status_file}.partial"; mv "${status_file}.partial" "$status_file"; } &
fi
command_pid=$!
set +m

have_ps=false
if ps -eo pgid=,pid=,stat= >/dev/null 2>&1; then have_ps=true; fi
group_members() {
  ps -eo pgid=,pid=,stat=,user=,args= 2>/dev/null | awk -v group="$command_pid" '
    $1 == group && $3 !~ /^Z/ { pid=$2; user=$4; $1=""; $2=""; $3=""; $4=""; sub(/^ +/, ""); printf "%s %s %s\n", pid, user, $0 }'
}
group_is_populated() {
  if [ "$have_ps" = true ]; then [ -n "$(group_members)" ]; else kill -0 -- "-$command_pid" 2>/dev/null; fi
}

sudo_kill_available=""
can_sudo_kill() {
  [ "$sudo_kill" = 1 ] || return 1
  if [ -z "$sudo_kill_available" ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then sudo_kill_available=yes; else sudo_kill_available=no; fi
  fi
  [ "$sudo_kill_available" = yes ]
}
signal_command() {
  local signal="$1"
  kill "-$signal" -- "-$command_pid" 2>/dev/null || kill "-$signal" "$command_pid" 2>/dev/null || true
  if group_is_populated && can_sudo_kill; then
    trace "survivors after SIG${signal}; retrying as root"
    sudo -n kill "-$signal" -- "-$command_pid" 2>/dev/null || sudo -n kill "-$signal" "$command_pid" 2>/dev/null || true
  fi
}
command_is_running() { [ -f "$status_file" ] && return 1; group_is_populated; }
# SECONDS crosses wall-clock boundaries and can over-read by almost a second.
# Strictly greater proves the full requested interval has actually elapsed.
has_elapsed() { [ "$SECONDS" -gt "$1" ]; }
wait_while_running() {
  local deadline=$((SECONDS + $1))
  while command_is_running && ! has_elapsed "$deadline"; do relay_output; sleep "$poll_seconds"; done
}
report_survivors() {
  local survivors
  survivors="$(group_members)"; [ -n "$survivors" ] || return 0
  echo "::error title=${label} left processes running::${label} could not be terminated. Still running: $(echo "$survivors" | tr '\n' ';')"
  echo "$survivors" >&2
}
terminate_over_budget() {
  local measured="$SECONDS"
  signal_command TERM
  wait_while_running "$grace_seconds"
  if command_is_running; then
    echo "${label} ignored SIGTERM after ${grace_seconds}s; sending SIGKILL."
    signal_command KILL; wait_while_running "$kill_seconds"
  fi
  report_survivors
  wait "$command_pid" 2>/dev/null || true; relay_output
  echo "::error title=${label} exceeded its execution budget::${label} ran for ${measured}s against its ${budget_seconds}s budget (detected at ${poll_seconds}s poll granularity) and was terminated. Command: $*"
  exit 124
}
# Invoked by the signal traps.
# shellcheck disable=SC2329
forward() { signal_command TERM; wait "$command_pid" 2>/dev/null || true; relay_output; exit 143; }
trap forward TERM INT

SECONDS=0; warned=false
while command_is_running; do
  if [ "$warned" = false ] && [ "$SECONDS" -ge "$warn_seconds" ]; then
    warned=true
    echo "::warning title=${label} is approaching its execution budget::${label} has run for ${SECONDS}s of its ${budget_seconds}s budget."
  fi
  if has_elapsed "$budget_seconds"; then terminate_over_budget "$@"; fi
  relay_output; sleep "$poll_seconds"
done
wait "$command_pid" 2>/dev/null; wait_status=$?; relay_output
if [ -f "$status_file" ]; then status="$(cat "$status_file")"; else status="$wait_status"; fi
exit "$status"
