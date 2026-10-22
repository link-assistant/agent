## Summary

Two defects in the pipeline status gate tooling:

1. `scripts/check-status-gate-covers-all-jobs.mjs` stops reading a block-form `needs:` list at the first line that is not exactly `      - <job>`. A comment line, a blank line or a trailing `# comment` ends the list. Every job after it is reported as a hole, and the check fails although the gate covers every job (a false positive).
2. The gates pass `BRANCH_NAME: ${{ github.head_ref || github.ref_name }}`, and `check-pipeline-status.sh` resolves it with `git ls-remote origin refs/heads/<branch>`. On a fork pull request that branch lives in the fork. The lookup either finds nothing (the gate fails closed on any cancellation) or finds an unrelated branch of the same name in this repository. In the second case a run that nothing superseded counts as superseded, so its cancellations are excused (a false negative).

## Reproduction (1)

Run against a clone at 0a62b80 (2026-10-10):

```bash
#!/usr/bin/env bash
set -euo pipefail
tpl="$(cd "$1" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp "$tpl/scripts/check-status-gate-covers-all-jobs.mjs" "$work/check.mjs"
cat > "$work/demo.yml" <<'YAML'
name: Demo
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: []
  test:
    runs-on: ubuntu-latest
    steps: []
  release:
    runs-on: ubuntu-latest
    steps: []
  pipeline-status:
    needs:
      - lint
      # Release jobs
      - test
      - release # publishes
    if: always()
    runs-on: ubuntu-latest
    steps: []
YAML
cd "$work" && node check.mjs demo.yml; echo "exit $?"
```

Output:

```
::error file=demo.yml::job 'test' is not in pipeline-status.needs; its failure cannot fail the run
::error file=demo.yml::job 'release' is not in pipeline-status.needs; its failure cannot fail the run
exit 1
```

## Reproduction (2)

Run the script below with `<clone> security.yml codeql`. The base repository's `main` is at one commit, and the fork's `main` (RUN_SHA) never moved; nothing superseded the run:

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
  codeql: it sets cancel-in-progress: true, so a supersede can cancel it
::warning title=Cancelled jobs in a superseded run::codeql. This run is no longer the head of main, and these jobs cancel in progress.
All required jobs succeeded or were legitimately skipped.
exit 0
```

From a fork branch whose name this repository lacks, the lookup returns nothing and every cancellation fails the gate.

## Workaround

(1) Keep `needs:` lists free of comments and blank lines. (2) None in the workflow; fork PRs see wrong verdicts.

## Suggested fix

(1) Skip comment and blank lines and strip trailing comments; stop only at the next key:

```js
for (const line of lines.slice(needsStart + 1)) {
  const text = line.replace(/\s+#.*$/, '');
  if (text.trim() === '' || text.trimStart().startsWith('#')) continue;
  const item = text.match(/^ {6}- ([a-zA-Z0-9_-]+)\s*$/);
  if (!item) break;
  neededJobs.push(item[1]);
}
```

(2) Compare against the pull request ref of the base repository. It exists for fork and same-repository PRs alike:

```yaml
RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}
```

Then run `git ls-remote origin "$HEAD_REF"`.

link-assistant/agent applied both in https://github.com/link-assistant/agent/pull/338: `listNeededJobs` in `js/tests/workflow-policy.js` and `scripts/check-pipeline-status.sh`.
