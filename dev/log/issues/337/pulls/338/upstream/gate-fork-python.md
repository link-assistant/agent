## Summary

Every `pipeline-status` gate passes `BRANCH_NAME: ${{ github.head_ref || github.ref_name }}`, and `scripts/check-pipeline-status.sh` resolves it with `git ls-remote "$GIT_REMOTE" "refs/heads/$BRANCH_NAME"`. On a fork pull request that branch exists only in the fork, so:

- With no same-named branch in this repository, the lookup returns nothing. Every cancelled job then fails the gate, including one a newer push cancelled through `cancel-in-progress: true` (a false positive).
- With a same-named branch here (for example a fork's `main`), the lookup returns this repository's branch, which differs from `RUN_SHA`. The run counts as superseded and its cancellations are excused even though nothing replaced it (a false negative).

## Reproduction

Run the script below with `<clone> security.yml dependency-audit`. The base repository's `main` is at one commit, and the fork's `main` (RUN_SHA) never moved; nothing superseded the run:

```bash
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
```

Output:

```
::warning title=Cancelled jobs in a superseded run::dependency-audit. This run is no longer the head of main and these jobs cancel in progress.
Pipeline passed.
exit 0
```

From a fork branch whose name this repository lacks, the lookup returns nothing and every cancellation fails the gate.

## Workaround

None in the workflow.

## Suggested fix

Resolve the head through the pull request ref of the base repository. It exists for fork and same-repository pull requests alike:

```yaml
RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}
```

```bash
head="$(git ls-remote "$GIT_REMOTE" "$HEAD_REF" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
```

link-assistant/agent applied this in https://github.com/link-assistant/agent/pull/338 (`scripts/check-pipeline-status.sh`).
