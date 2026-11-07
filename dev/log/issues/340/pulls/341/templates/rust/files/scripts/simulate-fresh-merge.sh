#!/usr/bin/env bash
# Simulate merging the pull request head into a fresh copy of the base branch and
# run the fast checks against that merge result.
#
# A pull request can be green in isolation and still break the base branch when a
# semantic (non-textual) conflict is introduced: both sides merge cleanly, but the
# combined tree no longer compiles or passes tests. GitHub only tests the PR head
# (or a merge commit computed at PR creation time), so this script recreates the
# merge locally against the current tip of the base branch.
#
# Environment:
#   GITHUB_BASE_REF - base branch name (set automatically for pull_request events)
#   FRESH_MERGE_CHECKS - optional newline-separated override of the commands to run
#   FRESH_MERGE_FETCH_ATTEMPTS - retries for the base fetch before giving up (default 5)
#   FRESH_MERGE_RETRY_DELAY_SECONDS - base of the linear backoff between fetch attempts (default 5)
set -euo pipefail

BASE_REF="${GITHUB_BASE_REF:-main}"
PREREQUISITE_RUNNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-javascript-first-auto.mjs"

if [ -z "${GITHUB_BASE_REF:-}" ]; then
  echo "GITHUB_BASE_REF is not set; assuming base branch '${BASE_REF}'"
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

# The script runs under `set -e`, so a single failed fetch used to abort the
# whole job before any check ran. GitHub's fetch endpoint does shed load, and a
# CI address range sees that more than a laptop does, so retry with linear
# backoff and only fail once the attempts are exhausted.
fetch_with_retry() {
  local attempt
  for attempt in $(seq 1 "${FRESH_MERGE_FETCH_ATTEMPTS}"); do
    if git fetch --no-tags origin "${BASE_REF}"; then
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

echo "Fetching origin/${BASE_REF}..."
fetch_with_retry

BASE_SHA="$(git rev-parse FETCH_HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"
echo "Base: ${BASE_REF} (${BASE_SHA})"
echo "Head: ${HEAD_SHA}"

if git merge-base --is-ancestor "${HEAD_SHA}" "${BASE_SHA}"; then
  echo "Head is already contained in origin/${BASE_REF}; nothing to simulate."
  exit 0
fi

# Merge into a detached checkout of the base tip so the working branch is untouched.
git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
git checkout --detach "${BASE_SHA}"

if ! git merge --no-edit "${HEAD_SHA}"; then
  echo "::error::Textual merge conflict with origin/${BASE_REF}. Merge the base branch into this pull request and resolve the conflicts."
  git merge --abort || true
  git checkout --force -
  exit 1
fi

echo "Merge succeeded. Running checks on the merged tree..."

# The simulated merge is a new revision and may introduce a native counterpart.
if ! EXPECTED_SHA="$(git rev-parse HEAD)" node "$PREREQUISITE_RUNNER"; then
  git checkout --force - >/dev/null 2>&1 || true
  exit 1
fi

DEFAULT_CHECKS='cargo fmt --all -- --check
bash scripts/check-cargo-warnings.sh
cargo clippy --all-targets --all-features
cargo test --all-features'
status=0
while IFS= read -r check; do
  [ -n "$check" ] || continue
  echo "::group::${check}"
  bash -e -o pipefail -c "$check" || status=1
  echo "::endgroup::"
done <<<"${FRESH_MERGE_CHECKS:-$DEFAULT_CHECKS}"

if [ "${status}" -ne 0 ]; then
  echo "::error::Checks failed on the simulated merge with origin/${BASE_REF} even though they pass on the pull request head. This is a semantic merge conflict."
fi

git checkout --force - >/dev/null 2>&1 || true
exit "${status}"
