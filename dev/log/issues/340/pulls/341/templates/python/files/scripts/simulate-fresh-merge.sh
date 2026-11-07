#!/usr/bin/env bash
# Simulate merging the latest PR base so CI validates the result that will land.
#
# Environment:
#   BASE_REF - base branch name (required)
#   FRESH_MERGE_FETCH_ATTEMPTS - retries for the base fetch before giving up
#                                (default 5)
#   FRESH_MERGE_RETRY_DELAY_SECONDS - base of the linear backoff between fetch
#                                     attempts (default 5)

set -euo pipefail

if [ -z "${BASE_REF:-}" ]; then
  echo "BASE_REF is required" >&2
  exit 2
fi

FRESH_MERGE_FETCH_ATTEMPTS="${FRESH_MERGE_FETCH_ATTEMPTS:-5}"
FRESH_MERGE_RETRY_DELAY_SECONDS="${FRESH_MERGE_RETRY_DELAY_SECONDS:-5}"

case "$FRESH_MERGE_FETCH_ATTEMPTS" in
  '' | *[!0-9]*)
    echo "FRESH_MERGE_FETCH_ATTEMPTS must be a positive integer, got: ${FRESH_MERGE_FETCH_ATTEMPTS}" >&2
    exit 2
    ;;
esac
case "$FRESH_MERGE_RETRY_DELAY_SECONDS" in
  '' | *[!0-9]*)
    echo "FRESH_MERGE_RETRY_DELAY_SECONDS must be a non-negative integer number of seconds, got: ${FRESH_MERGE_RETRY_DELAY_SECONDS}" >&2
    exit 2
    ;;
esac

echo "Synchronizing PR with latest $BASE_REF"

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

# The script runs under `set -e`, so a single failed fetch used to abort the
# whole job before any check ran (issue #70). GitHub's fetch endpoint does shed
# load, and a CI address range sees that more than a laptop does, so retry with
# linear backoff and only fail once the attempts are exhausted -- a base branch
# that truly cannot be fetched must still fail, because silently skipping the
# merge simulation is the false negative the check exists to prevent.
fetch_with_retry() {
  local attempt
  for attempt in $(seq 1 "${FRESH_MERGE_FETCH_ATTEMPTS}"); do
    if git fetch origin "${BASE_REF}"; then
      if [ "${attempt}" -gt 1 ]; then
        echo "Fetched origin/${BASE_REF} on attempt ${attempt} of ${FRESH_MERGE_FETCH_ATTEMPTS}."
      fi
      return 0
    fi
    if [ "${attempt}" -lt "${FRESH_MERGE_FETCH_ATTEMPTS}" ]; then
      echo "::warning::git fetch of origin/${BASE_REF} failed (attempt ${attempt} of ${FRESH_MERGE_FETCH_ATTEMPTS}); retrying in $(( FRESH_MERGE_RETRY_DELAY_SECONDS * attempt ))s..."
      sleep $(( FRESH_MERGE_RETRY_DELAY_SECONDS * attempt ))
    fi
  done
  echo "::error::Could not fetch origin/${BASE_REF} after ${FRESH_MERGE_FETCH_ATTEMPTS} attempts. The merge simulation needs the current base tip: without it no check runs at all. Check connectivity to the remote and that the base branch '${BASE_REF}' still exists there." >&2
  return 1
}

fetch_with_retry

behind_count=$(git rev-list --count "HEAD..origin/$BASE_REF")
if [ "$behind_count" -eq 0 ]; then
  echo "Merge preview is up to date with $BASE_REF"
  exit 0
fi

echo "Base branch has $behind_count new commit(s); simulating a fresh merge"
if git merge "origin/$BASE_REF" --no-edit; then
  echo "Fresh merge simulation succeeded"
else
  echo "::error::Merge conflict detected with latest $BASE_REF" >&2
  exit 1
fi
