#!/usr/bin/env bash
# Probe the same API as dependency-review-action. A disabled repository setting
# is advisory on PRs, but main/scheduled runs require an administrator to fix it.
# Only a plain 403 proves disabled: retry rate limits, server/network errors,
# and missing comparison refs. Set DEPENDENCY_GRAPH_DEBUG=1 for response tracing.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
base="${GITHUB_BASE_SHA:-${GITHUB_SHA:?GITHUB_SHA is required}}"
head="${GITHUB_HEAD_SHA:-$GITHUB_SHA}"
retry_seconds="${DEPENDENCY_GRAPH_RETRY_SECONDS:-10}"
state=unknown

for attempt in 1 2 3; do
  status=0
  response="$(gh api "repos/$repo/dependency-graph/compare/$base...$head" 2>&1)" || status=$?
  if [ "${DEPENDENCY_GRAPH_DEBUG:-0}" = 1 ]; then
    printf '[dependency-graph] attempt %s: exit %s, response: %.500s\n' "$attempt" "$status" "$response"
  fi
  if [ "$status" = 0 ]; then
    state=enabled
    break
  fi
  if ! printf '%s' "$response" | grep -qi 'rate.limit' &&
    printf '%s' "$response" | grep -q '(HTTP 403)'; then
    state=disabled
    break
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "Dependency graph probe returned no definite answer (attempt $attempt/3); retrying."
    sleep "$retry_seconds"
  fi
done

enabled=unknown
case "$state" in
  enabled) enabled=true ;;
  disabled) enabled=false ;;
esac
printf 'enabled=%s\nstate=%s\n' "$enabled" "$state" >> "${GITHUB_OUTPUT:-/dev/null}"

if [ "$state" = enabled ]; then
  echo "Dependency graph is enabled."
  exit 0
fi
if [ "$state" = disabled ]; then
  message="Dependency graph is disabled for $repo, so dependency review cannot run. A repository admin must enable it: https://github.com/$repo/settings/security_analysis -> Dependency graph -> Enable."
else
  message="Dependency graph status is unknown for $repo after 3 attempts. Re-run the job; set DEPENDENCY_GRAPH_DEBUG=1 to inspect API responses."
fi
if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  echo "::warning::$message Skipping dependency review for this pull request."
else
  echo "::error::$message"
  exit 1
fi
