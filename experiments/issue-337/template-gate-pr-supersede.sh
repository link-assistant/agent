#!/usr/bin/env bash
# Reproduce: the rust template's pipeline gate fails a pull request run that a
# newer push superseded. Usage: template-gate-pr-supersede.sh <template-clone>
set -euo pipefail
tpl="$(cd "$1" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -r "$tpl/scripts" "$work/scripts"; mkdir -p "$work/.github/workflows"
cp "$tpl/.github/workflows/release.yml" "$work/.github/workflows/"
# A remote whose pull request head moved on (refs/pull/7/head = newer commit).
git -C "$work" init -q -b main
git -C "$work" -c user.name=t -c user.email=t@e commit -q --allow-empty -m newer
git -C "$work" update-ref refs/pull/7/head HEAD
cd "$work"
# As release.yml passes them on pull_request: RUN_SHA=github.sha (the merge
# commit), BRANCH_REF=github.ref_name ("7/merge").
env -i PATH="$PATH" HOME="$HOME" \
  NEEDS_JSON='{"test":{"result":"cancelled"},"lint":{"result":"success"}}' \
  IS_MAIN=false RUN_SHA="$(printf 'a%.0s' {1..40})" BRANCH_REF=7/merge \
  GIT_REMOTE="$work" GITHUB_REF=refs/pull/7/merge \
  WORKFLOW_FILE=.github/workflows/release.yml PIPELINE_STATUS_VERBOSE=1 \
  bash scripts/check-pipeline-status.sh && echo "exit 0" || echo "exit $?"
echo "--- with the head lookup fixed (BRANCH_HEAD_SHA of the newer commit):"
env -i PATH="$PATH" HOME="$HOME" \
  NEEDS_JSON='{"test":{"result":"cancelled"}}' RUN_SHA="$(printf 'a%.0s' {1..40})" \
  BRANCH_HEAD_SHA="$(git rev-parse HEAD)" BRANCH_REF=7/merge GITHUB_REF=refs/pull/7/merge \
  WORKFLOW_FILE=.github/workflows/release.yml \
  bash scripts/check-pipeline-status.sh && echo "exit 0" || echo "exit $?"
