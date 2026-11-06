#!/usr/bin/env bash
# Probe the comparison API before dependency-review. Transient API failures are
# unknown, never evidence that an administrator disabled the dependency graph.
set -euo pipefail
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || { echo "usage: $0 BASE HEAD [--require]" >&2; exit 2; }
: "${REPO:?REPO is required}"
base="$1"; head="$2"; required="${3:-}"
[ -z "$required" ] || [ "$required" = --require ] || exit 2
attempts="${DEPENDENCY_GRAPH_ATTEMPTS:-3}"
delay="${DEPENDENCY_GRAPH_RETRY_DELAY_SECONDS:-2}"
case "$attempts:$delay" in *[!0-9:]* | :* | *:) echo 'Invalid retry configuration' >&2; exit 2;; esac
[ "$attempts" -gt 0 ] || exit 2
state=unknown
for ((attempt=1; attempt<=attempts; attempt++)); do
  if response="$(gh api "repos/${REPO}/dependency-graph/compare/${base}...${head}" 2>&1)"; then
    state=enabled
    break
  elif printf '%s' "$response" | grep -qiE 'rate.?limit|abuse|retry.after'; then
    state=unknown
  elif printf '%s' "$response" | grep -q '(HTTP 403)'; then
    state=disabled
    break
  else
    state=unknown
  fi
  echo "Dependency graph probe $attempt/$attempts was inconclusive: $response" >&2
  if [ "$attempt" -lt "$attempts" ]; then sleep "$delay"; fi
done
enabled=false
[ "$state" != enabled ] || enabled=true
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'state=%s\nenabled=%s\n' "$state" "$enabled" >> "$GITHUB_OUTPUT"
fi
case "$state" in
  enabled) echo 'Dependency graph comparison is available.';;
  disabled)
    message="Enable Dependency graph at https://github.com/${REPO}/settings/security_analysis so Dependency Review can run."
    if [ "$required" = --require ]; then echo "::error::$message"; exit 1; fi
    echo "::warning::$message Skipping Dependency Review for this pull request.";;
  unknown)
    message='Dependency graph availability is unknown after retries. Check GitHub API connectivity, permissions and rate limits.'
    if [ "$required" = --require ]; then echo "::error::$message"; exit 1; fi
    echo "::warning::$message Skipping Dependency Review for this pull request.";;
esac
