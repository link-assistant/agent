# Case Study: Issue #23 - Best CI/CD Practices from Hive Mind Repository

## Summary

This case study documents the incorporation of best CI/CD practices from the [hive-mind repository](https://github.com/link-assistant/hive-mind), specifically addressing the critical issue of **stale merge preview** in GitHub Actions. The key insight comes from [hive-mind issue #1141](https://github.com/link-assistant/hive-mind/issues/1141) and its fix in [PR #1142](https://github.com/link-assistant/hive-mind/pull/1142).

## The Problem: GitHub's Stale Merge Preview Architecture

### How GitHub Actions Handles Pull Requests

When a PR triggers a GitHub Actions workflow (`on: pull_request`), GitHub performs these steps:

1. Creates a synthetic merge commit at `refs/pull/{number}/merge`
2. This merge commit represents what the merge **would look like** at the moment of creation
3. `actions/checkout@v4` checks out this merge preview by default
4. **The merge preview does NOT automatically update** when the base branch changes

### The Critical Gap

```
Day 1: PR opened/synced
       -> GitHub creates merge preview (validates correctly)
       -> CI runs on merge preview -> PASSES

[Time passes - other PRs merge to main, changing the codebase]

Day N: PR merged (without re-running CI)
       -> Actual merge result differs from stale preview
       -> Push CI runs on actual merge -> FAILS
```

This is exactly what happened in hive-mind issue #1141, where:

- Jan 11: PR #1105 CI passed (merge preview showed file at 1495 lines)
- Jan 19: PR merged (actual result was 1506 lines due to intervening changes)
- Push CI failed because the actual merge exceeded the 1500-line limit

### Why This Matters

The stale merge preview issue creates a **false sense of security**:

- Developers see green CI checks on their PR
- They merge confidently
- Main branch CI fails after merge
- The team scrambles to fix a broken main branch

## Solutions Implemented

### 1. Fresh Merge Simulation in CI Workflow

Added to both `lint` and `test` jobs in `.github/workflows/release.yml`:

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    # Fetch the latest base branch
    git fetch origin "$BASE_REF"

    # Check if base branch has new commits
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)

    if [ "$BEHIND_COUNT" -gt 0 ]; then
      # Merge latest base branch to simulate actual merge result
      git merge origin/$BASE_REF --no-edit || exit 1
    fi
```

This ensures PR CI validates the **actual** merge result, not a stale snapshot.

### 2. ESLint max-lines Rule

Already configured in `eslint.config.js`:

```javascript
'max-lines': ['error', 1500]
```

This provides:

- Local development feedback via editor integration
- CI enforcement via `npm run lint`
- Early warning before files become unmaintainable

### 3. Version Check CI Job

Already configured in `.github/workflows/release.yml`:

```yaml
version-check:
  name: Check for Manual Version Changes
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

This prevents manual version changes in PRs - versions should only be changed by the CI/CD pipeline using changesets.

## Root Cause Analysis

### Primary Root Cause: GitHub's Merge Preview Design

The fundamental issue is architectural:

1. GitHub's `refs/pull/{number}/merge` is a **snapshot**, not a live reference
2. It's created when the PR is opened or synchronized
3. It does **not** update when the base branch receives new commits
4. Long-lived PRs are particularly vulnerable

### Contributing Factors

1. **No automatic re-validation**: GitHub doesn't automatically re-run CI when the base branch changes
2. **Time gap vulnerability**: The longer a PR sits open, the more likely it is to have a stale merge preview
3. **Silent desynchronization**: There's no warning that the merge preview is outdated

## Evidence from CI Logs

### From hive-mind Issue #1141

**Passed CI Run #20889393003 (PR Branch - January 11):**

```
check-file-line-limits: [command]/usr/bin/git checkout --progress --force refs/remotes/pull/1105/merge
check-file-line-limits: ./src/claude.lib.mjs: 1495 lines
```

**Failed CI Run #21128634082 (Main Branch - January 19):**

```
detect-changes: Comparing HEAD^ to HEAD
check-file-line-limits: ./src/claude.lib.mjs: 1506 lines
check-file-line-limits: ERROR: ./src/claude.lib.mjs has 1506 lines, which exceeds the 1500 line limit!
```

The 8-day gap between PR CI pass and merge allowed other changes to accumulate, causing the actual merge to exceed the limit.

## Prevention Recommendations

### Implemented in This Template

1. **Fresh Merge Simulation**: CI simulates a fresh merge before running checks
2. **ESLint max-lines Rule**: Enforces file size limits at lint time
3. **Version Check**: Prevents manual version changes

### Additional Protection Options

For teams wanting extra protection:

1. **Enable GitHub Merge Queue**: Tests PRs against the latest main before merge
2. **Require Branches Up-to-Date**: Force PRs to be rebased before merging
3. **Add Pre-commit Hooks**: Check constraints locally before pushing
4. **Branch Protection Rules**: Require status checks to pass before merging

## Research: Online Sources

### GitHub's Merge Preview Behavior

According to [GitHub Actions and Merge Conflicts analysis](https://medium.com/@FartsyRainbowOctopus/github-actions-and-merge-conflicts-a-comprehensive-analysis-and-definitive-guide-to-unlocking-54fa45a38886):

> For "on: pull_request" workflows to accurately validate code in its merged state, GitHub executes a crucial preliminary step: it attempts to create a temporary merge commit by merging the pull request's head branch into its base branch.

### GitHub Merge Queue Benefits

According to [GitHub Docs on Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue):

> The merge queue will ensure the pull request's changes pass all required status checks when applied to the latest version of the target branch and any pull requests already in the queue.

### Best Practices for CI

According to [Graphite's best practices guide](https://graphite.com/guides/best-practices-managing-merge-queue):

> How well your GitHub merge queue works really comes down to the status checks you mark as required. These are the automated tasks – think CI builds, tests, linters, or security scans – that absolutely must pass on those temporary merge branches before a PR gets merged.

## Timeline of Events

| Date       | Event                                                   | Result               |
| ---------- | ------------------------------------------------------- | -------------------- |
| 2026-01-11 | PR #1105 CI passes in hive-mind (merge preview at 1495) | Green checkmark      |
| 2026-01-14 | Other PRs add lines to file                             | File grows           |
| 2026-01-15 | More changes push file to 1512 lines                    | Still over limit     |
| 2026-01-15 | Attempt to fix brings it to 1498 lines                  | Back under limit     |
| 2026-01-19 | PR #1105 merged (actual merge at 1506 lines)            | Main branch CI fails |
| 2026-01-19 | Issue #1141 created in hive-mind                        | Investigation begins |
| 2026-01-19 | PR #1142 implements fresh merge simulation fix          | Solution implemented |
| 2026-01-19 | Issue #23 created to port fixes to this template        | Current case study   |

## Files in This Case Study

- `README.md` - This documentation
- `data/` - Downloaded logs and data from hive-mind repository
  - `pr-1142-diff.txt` - Full diff of the fix PR
  - `pr-1127-diff.txt` - Diff of version-check addition
  - `issue-1141-details.txt` - Original issue description
  - `hive-mind-release.yml` - Reference workflow file

## Related Issues and PRs

- [hive-mind Issue #1141](https://github.com/link-assistant/hive-mind/issues/1141): Make sure our lines count checks are synchronized in CI/CD
- [hive-mind PR #1142](https://github.com/link-assistant/hive-mind/pull/1142): fix: synchronize line count checks in CI/CD
- [hive-mind PR #1127](https://github.com/link-assistant/hive-mind/pull/1127): Add --prompt-subagents-via-agent-commander option (includes version-check CI job)

## Conclusion

The stale merge preview issue is a fundamental architectural limitation of GitHub's pull request CI system. By implementing fresh merge simulation in our CI workflows, we ensure that:

1. PR CI validates the **actual** merge result, not a stale snapshot
2. Developers get accurate feedback before merging
3. Main branch CI failures due to stale previews are prevented
4. Team productivity is maintained by avoiding post-merge firefighting

This solution has been proven effective in the hive-mind repository and is now incorporated into this template for all projects to benefit from.
