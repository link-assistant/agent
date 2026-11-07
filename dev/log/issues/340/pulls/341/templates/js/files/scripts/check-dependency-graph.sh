#!/usr/bin/env bash
# Reports whether the repository's dependency graph is enabled, which
# actions/dependency-review-action needs. Enabling it is a repository setting
# that only an administrator can change, so pull requests skip the review
# with a warning while pushes to main fail with instructions.
#
# Only a plain `403 Forbidden` from the dependency review API means the graph
# is disabled. Rate limits, server errors and network failures are retried
# and then reported as "unknown" instead of being mistaken for a disabled
# graph.
#
# Usage: check-dependency-graph.sh <base-sha> <head-sha> [--require]
# Needs GH_TOKEN and REPO; writes `enabled=true|false` and
# `state=enabled|disabled|unknown` to GITHUB_OUTPUT.
# Optional: DEPENDENCY_GRAPH_ATTEMPTS (default 3),
# DEPENDENCY_GRAPH_RETRY_SECONDS (default 10) and DEPENDENCY_GRAPH_DEBUG=1,
# which prints every raw API answer.
set -euo pipefail
BASE="${1:?base commit is required}"
HEAD="${2:?head commit is required}"
MODE="${3:-}"
ATTEMPTS="${DEPENDENCY_GRAPH_ATTEMPTS:-3}"
RETRY_SECONDS="${DEPENDENCY_GRAPH_RETRY_SECONDS:-10}"
SETTINGS="https://github.com/${REPO:?REPO is required}/settings/security_analysis"

debug() {
  if [ "${DEPENDENCY_GRAPH_DEBUG:-0}" = 1 ]; then echo "[debug] $*"; fi
}

# Prints enabled, disabled or retry for one answer of `gh api`.
classify() {
  local status="$1" response="$2"
  if [ "$status" = 0 ]; then
    echo enabled
  elif printf '%s' "$response" | grep -qi 'rate limit'; then
    echo retry
  elif printf '%s' "$response" | grep -q '(HTTP 403)'; then
    echo disabled
  else
    echo retry
  fi
}

state=unknown
response=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  status=0
  response="$(gh api "repos/$REPO/dependency-graph/compare/$BASE...$HEAD" 2>&1)" || status=$?
  verdict="$(classify "$status" "$response")"
  debug "attempt $attempt/$ATTEMPTS: exit $status, verdict $verdict, answer: $response"
  if [ "$verdict" != retry ]; then
    state="$verdict"
    break
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo "GitHub did not give a definite answer (attempt $attempt/$ATTEMPTS); retrying in ${RETRY_SECONDS}s."
    sleep "$RETRY_SECONDS"
  fi
done

enabled=false
[ "$state" = enabled ] && enabled=true
{
  echo "enabled=$enabled"
  echo "state=$state"
} >> "${GITHUB_OUTPUT:-/dev/null}"
[ "$state" = enabled ] && { echo "The dependency graph is enabled."; exit 0; }

echo "GitHub answered: ${response:0:300}"
if [ "$state" = disabled ]; then
  message="The dependency graph of $REPO is disabled, so dependency review cannot run. \
A repository administrator has to enable \"Dependency graph\" at $SETTINGS."
else
  message="Could not tell whether the dependency graph of $REPO is enabled: \
the GitHub API gave no definite answer after $ATTEMPTS attempts. Re-run the job; \
set DEPENDENCY_GRAPH_DEBUG=1 to print every answer."
fi
if [ "$MODE" = "--require" ]; then
  echo "::error::$message"
  exit 1
fi
echo "::warning::$message Skipping dependency review for this pull request."
