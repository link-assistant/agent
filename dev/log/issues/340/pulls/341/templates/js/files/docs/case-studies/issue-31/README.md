# Case Study: Per-commit diff for change detection

**Issue:** [#31](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/31)
**Source:** [link-assistant/web-capture#50](https://github.com/link-assistant/web-capture/issues/50), [link-assistant/web-capture#51](https://github.com/link-assistant/web-capture/pull/51)

## Problem Statement

The `scripts/detect-code-changes.mjs` script compared `GITHUB_BASE_SHA` to `GITHUB_HEAD_SHA` for pull request events. This returns **all files changed across the entire PR**, not just what the latest push changed. A commit that only modifies non-code files (e.g., `.gitkeep`, `README.md`) still triggers all CI jobs if any earlier commit in the same PR touched code files.

## Root Cause

Two separate mechanisms cause full-PR diffs instead of per-commit diffs:

### 1. `GITHUB_BASE_SHA...GITHUB_HEAD_SHA` comparison

The original script used environment variables to compare the PR base against the PR head:

```javascript
const output = exec(`git diff --name-only ${baseSha} ${headSha}`);
```

This gives the same result as GitHub Actions `paths:` filters — the full PR diff.

### 2. GitHub Actions synthetic merge commit

GitHub Actions creates a **synthetic merge commit** for `pull_request` events:

- `HEAD` = synthetic merge commit (not the actual PR head)
- `HEAD^` = base branch (first parent)
- `HEAD^2` = actual PR head commit (second parent)

Even `git diff HEAD^ HEAD` gives the full PR diff, because `HEAD^` is the base branch.

### Evidence

In [link-assistant/web-capture PR #49](https://github.com/link-assistant/web-capture/pull/49), commit `0e9b6e8c` only modified `.gitkeep` but triggered all 8 CI jobs (lint, test on 3 OSes, build, changeset check) because the PR as a whole contained code changes.

## Timeline

1. PR #49 in web-capture opened with commits touching `js/` and `rust/` code
2. Commit `0e9b6e8c` pushed — only modifies `.gitkeep` at repo root
3. Full CI suite triggered because diff evaluates all PR files, not just the latest push
4. [web-capture#50](https://github.com/link-assistant/web-capture/issues/50) filed requesting fix
5. [web-capture#51](https://github.com/link-assistant/web-capture/pull/51) implements fix with per-commit diff via merge commit detection
6. [This issue (#31)](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/31) filed to port the fix to this template repo

## Solution

### Per-commit diff via merge commit detection

The script now detects GitHub Actions' synthetic merge commit and uses the correct diff range:

```javascript
function isMergeCommit() {
  const parentCount = exec('git cat-file -p HEAD')
    .split('\n')
    .filter((line) => line.startsWith('parent ')).length;
  return parentCount > 1;
}
```

For merge commits (PR events): `git diff HEAD^2^ HEAD^2` — the per-commit diff of the actual PR head commit.

For push events (non-merge): `git diff HEAD^ HEAD` — regular per-commit diff.

### Fallback handling

- If `HEAD^2^` doesn't exist (first commit in PR), falls back to `git diff HEAD^ HEAD^2` (full diff against base)
- If `HEAD^` doesn't exist (first commit ever), falls back to `git ls-tree --name-only -r HEAD`

### Environment variable cleanup

The `GITHUB_BASE_SHA` and `GITHUB_HEAD_SHA` environment variables were removed from the workflow since the script no longer uses them — merge commit detection via `git cat-file` is self-contained.

## Files Changed

| File                                  | Change                                                               |
| ------------------------------------- | -------------------------------------------------------------------- |
| `scripts/detect-code-changes.mjs`     | Replace full-PR diff with per-commit diff via merge commit detection |
| `.github/workflows/release.yml`       | Remove unused `GITHUB_BASE_SHA`/`GITHUB_HEAD_SHA` env vars           |
| `experiments/test-detect-changes.mjs` | 17 edge-case tests for change classification logic                   |

## Verification

With this fix, if a commit only modifies `.gitkeep`:

- `detect-changes` job runs (lightweight, ~5s)
- Merge commit detected, per-commit diff used (`HEAD^2^..HEAD^2`)
- All outputs are `false` (only `.gitkeep` changed)
- All downstream jobs (lint, test, changeset check) are **skipped**
- CI minutes saved: ~15-30 minutes per non-code commit

## References

- [web-capture PR #51](https://github.com/link-assistant/web-capture/pull/51) — original implementation with CI verification
- [web-capture issue #50](https://github.com/link-assistant/web-capture/issues/50) — original bug report with evidence
- [rust-ai-driven-development-pipeline-template#34](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/34) — same bug in Rust template
