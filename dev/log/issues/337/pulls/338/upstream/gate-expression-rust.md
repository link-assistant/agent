## Summary

`scripts/check-pipeline-status.sh` treats every `cancel-in-progress` written as an expression as `unknown`, and `unknown` never excuses a cancellation. `release.yml` writes the cancel policy of 14 jobs as `${{ github.ref != 'refs/heads/main' }}`. So a pull request run that a newer push superseded still fails its `Pipeline Status` gate after #200 is fixed: a false positive on every superseded PR run whose jobs were cancelled.

## Reproduction

The script below, run against a clone of this repository at 265219d (2026-10-10), copies `scripts/` and `release.yml` into a temp dir and runs the gate twice. In both runs `test` was cancelled by a newer push to PR #7:

```bash
#!/usr/bin/env bash
set -euo pipefail
tpl="$(cd "$1" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cp -r "$tpl/scripts" "$work/scripts"; mkdir -p "$work/.github/workflows"
cp "$tpl/.github/workflows/release.yml" "$work/.github/workflows/"
git -C "$work" init -q -b main
git -C "$work" -c user.name=t -c user.email=t@e commit -q --allow-empty -m newer
cd "$work"
# The head lookup already fixed (as #200 proposes): the PR head moved on.
env -i PATH="$PATH" HOME="$HOME" \
  NEEDS_JSON='{"test":{"result":"cancelled"}}' RUN_SHA="$(printf 'a%.0s' {1..40})" \
  BRANCH_HEAD_SHA="$(git rev-parse HEAD)" BRANCH_REF=feature GITHUB_REF=refs/pull/7/merge \
  WORKFLOW_FILE=.github/workflows/release.yml \
  bash scripts/check-pipeline-status.sh; echo "exit $?"
```

Output:

```
Cancelled jobs: test
This run tests aaaa…; feature is at 6c57d01….
  test: its cancel-in-progress value is an expression the gate cannot evaluate
::error title=Pipeline has cancelled jobs::test. No supersede accounts for these cancellations; …
exit 1
```

`test` sets `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. That expression is `true` on `refs/pull/7/merge`, so the newer push cancelled it as designed.

## Workaround

Write `cancel-in-progress: true` / `false` literally. That loses the "never cancel on main" behaviour, so it is not a real option for `release.yml`.

## Suggested fix

Evaluate the `github.ref` comparisons the template itself uses, and keep `unknown` for everything else. `GITHUB_REF` is the same value the expression saw:

```js
export function evaluateCancelInProgress(value, ref) {
  if (value === 'true') return true;
  if (value === 'false' || value === 'none' || value === 'missing')
    return false;
  const m = value.match(/^\$\{\{\s*github\.ref\s*(==|!=)\s*'([^']*)'\s*\}\}$/);
  if (!m || !ref) return null; // unknown: never excuses a cancellation
  return m[1] === '==' ? ref === m[2] : ref !== m[2];
}
```

Also add a test that reads every job of `release.yml` and asserts its value is evaluable, so a new expression cannot quietly turn superseded runs red again.

For the head lookup in #200, `refs/pull/<n>/head` of the base repository also resolves fork pull requests, which `refs/heads/<head_ref>` cannot:

```yaml
RUN_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}
```

`git ls-remote origin "$HEAD_REF"` then compares the run with the current head of the pull request.

link-assistant/agent applied both fixes in https://github.com/link-assistant/agent/pull/338: `scripts/job-cancel-policy.mjs`, `scripts/check-pipeline-status.sh`, and `js/tests/check-pipeline-status.js`.
