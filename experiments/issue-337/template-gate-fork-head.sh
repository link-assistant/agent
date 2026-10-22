#!/usr/bin/env bash
# Reproduce: a fork pull request from a branch named like one in the base
# repository (main) is judged against the base branch, so a cancellation that
# no newer run caused passes the gate.
# Usage: template-gate-fork-head.sh <template-clone> <workflow-with-a-cancel-in-progress-true-job> <job>
set -euo pipefail
tpl="$(cd "$1" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -r "$tpl/scripts" "$work/scripts"; mkdir -p "$work/.github/workflows"
cp "$tpl/.github/workflows/$2" "$work/.github/workflows/"
git -C "$work" init -q -b main
git -C "$work" -c user.name=t -c user.email=t@e commit -q --allow-empty -m base-main
cd "$work"
fork_head="$(printf 'f%.0s' {1..40})" # the fork's main: never pushed again
env -i PATH="$PATH" HOME="$HOME" \
  NEEDS_JSON="{\"$3\":{\"result\":\"cancelled\"}}" RUN_SHA="$fork_head" \
  BRANCH_NAME=main GIT_REMOTE="$work" GITHUB_REF=refs/pull/7/merge \
  WORKFLOW_FILE=".github/workflows/$2" \
  bash scripts/check-pipeline-status.sh && echo "exit 0" || echo "exit $?"
