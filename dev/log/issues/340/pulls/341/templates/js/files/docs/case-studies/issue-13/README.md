# Case Study: Robust Changeset CI/CD for Concurrent PRs

## Issue Reference

- **Issue**: [#13 - Apply latest CI/CD experience from hive-mind project](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/13)
- **Reference PR**: [hive-mind#961 - Improve changeset CI/CD robustness for concurrent PRs](https://github.com/link-assistant/hive-mind/pull/961)
- **Reference Issue**: [hive-mind#960 - Better changeset CI/CD](https://github.com/link-assistant/hive-mind/issues/960)

## Timeline of Events

### 2025-12-21 18:23 UTC - CI Failure Trigger

A CI failure occurred on hive-mind PR #728 during the changeset validation step:

```
Found 4 changeset file(s)
Error: Multiple changesets found (4). Each PR should have exactly ONE changeset.
Error: Found changeset files:
  fix-perlbrew-unbound-variable.md
  increase-min-disk-space.md
  readme-initialization.md
  sync-package-lock-json.md
Error: Process completed with exit code 1.
```

**Source**: [GitHub Actions Run #20413963959](https://github.com/link-assistant/hive-mind/actions/runs/20413963959/job/58654854890?pr=728)

### 2025-12-22 06:31 UTC - Issue Created

Issue #960 was created describing the problem and proposing a more robust changeset CI/CD system.

### 2025-12-22 ~18:00 UTC - Solution Implemented

PR #961 was created and merged implementing the solution.

### 2025-12-22 19:22 UTC - Issue Closed

Issue #960 was closed as the fix was merged.

## Root Cause Analysis

### The Problem

The original `validate-changeset.mjs` script checked **all** changeset files in the `.changeset` directory:

```javascript
// Original problematic approach
const changesetFiles = readdirSync(changesetDir).filter(
  (file) => file.endsWith('.md') && file !== 'README.md'
);

if (changesetCount > 1) {
  console.error(`Multiple changesets found (${changesetCount})`);
  process.exit(1);
}
```

This approach fails when:

1. **Multiple PRs merge before a release cycle completes**: If PR-A merges with changeset-A, then PR-B opens, it will see changeset-A in the directory and fail validation even though PR-B only added changeset-B.

2. **Race condition in concurrent development**: In active repositories, multiple contributors work simultaneously. If their PRs don't merge fast enough between release cycles, changesets accumulate.

3. **Release process delay or failure**: If the release workflow fails (npm outage, CI failure), changesets accumulate and block all subsequent PRs.

### Why This Happens

The [changesets](https://github.com/changesets/changesets) workflow is designed to accumulate changes:

> "When two changesets are included which are of the type minor, the minor release will only be bumped once."

However, this design assumes:

- The release workflow runs successfully after each merge
- Or the PR validation is aware of what the PR actually added vs. what was pre-existing

The original implementation violated the second assumption by treating all existing changesets as if they were added by the current PR.

## Proposed Solutions

### Solution 1: Check Only PR-Added Changesets (Implemented)

Use `git diff` to compare the PR branch against the base branch and only validate changesets that were **added** by the current PR:

```javascript
// Get changeset files ADDED by this PR only
const diffOutput = execSync(`git diff --name-status ${baseSha} ${headSha}`);
const addedChangesets = [];

for (const line of diffOutput.trim().split('\n')) {
  const [status, filePath] = line.split('\t');
  if (
    status === 'A' &&
    filePath.startsWith('.changeset/') &&
    filePath.endsWith('.md')
  ) {
    addedChangesets.push(filePath);
  }
}
```

**Benefits**:

- PRs are validated in isolation
- Pre-existing changesets don't cause false failures
- No need to merge default branch before PR can pass

### Solution 2: Merge Multiple Changesets at Release Time

During the release workflow, if multiple changesets exist, merge them into a single changeset before running `changeset version`:

```javascript
// Determine highest bump type (major > minor > patch)
const highestBumpType = getHighestBumpType(parsedChangesets.map((c) => c.type));

// Combine descriptions chronologically
const descriptions = parsedChangesets
  .sort((a, b) => a.mtime - b.mtime)
  .map((c) => c.description);

// Create merged changeset
const mergedContent = createMergedChangeset(highestBumpType, descriptions);
```

**Benefits**:

- Preserves changelog history from all changes
- Uses correct version bump (highest severity wins)
- Maintains chronological order of changes
- Cleans up after merging

### Solution 3: Environment Variables for Git Context

Pass explicit SHA references from GitHub Actions to the validation script:

```yaml
- name: Check for changesets
  env:
    GITHUB_BASE_SHA: ${{ github.event.pull_request.base.sha }}
    GITHUB_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: node scripts/validate-changeset.mjs
```

**Benefits**:

- Reliable git context in CI
- No need to fetch/calculate base branch
- Works with shallow clones

## Industry Best Practices

According to [Changesets documentation](https://github.com/changesets/changesets):

1. **Use the changeset bot** to detect missing changesets rather than failing builds
2. **Not every commit needs a changeset** - docs and tests don't require releases
3. **Changesets decouple intent from publishing** - team transparency

According to [pnpm documentation](https://pnpm.io/using-changesets):

1. **Changesets accumulate** and are processed together at release time
2. **Multiple PRs with changesets** should merge cleanly
3. **The release PR** handles version bumping and changelog generation

According to [Infinum Frontend Handbook](https://infinum.com/handbook/frontend/changesets):

1. **PRs created with GITHUB_TOKEN don't trigger other workflows**
2. **Use a Personal Access Token (PAT)** for automated PRs that need CI checks
3. **Changesets action** can automate versioning PRs

## Files Changed in Reference PR #961

| File                                     | Change Type | Purpose                                   |
| ---------------------------------------- | ----------- | ----------------------------------------- |
| `scripts/validate-changeset.mjs`         | Modified    | Check only PR-added changesets            |
| `scripts/merge-changesets.mjs`           | Added       | Merge multiple changesets at release time |
| `.github/workflows/release.yml`          | Modified    | Pass SHA env vars, add merge step         |
| `experiments/test-changeset-scripts.mjs` | Added       | Comprehensive test suite                  |

## Implementation Status

This case study documents the analysis. The actual implementation will:

1. Update `scripts/validate-changeset.mjs` to use git diff approach
2. Add `scripts/merge-changesets.mjs` for release-time merging
3. Update `.github/workflows/release.yml` with new steps
4. Add tests in `experiments/test-changeset-scripts.mjs`
5. Update README.md with design decision documentation

## References

- [Changesets GitHub Repository](https://github.com/changesets/changesets)
- [Using Changesets with pnpm](https://pnpm.io/using-changesets)
- [Infinum Frontend Handbook - Changesets](https://infinum.com/handbook/frontend/changesets)
- [Automate NPM releases with changesets](https://dev.to/ignace/automate-npm-releases-on-github-using-changesets-25b8)
- [Failed CI Run Log](https://github.com/link-assistant/hive-mind/actions/runs/20413963959/job/58654854890?pr=728)
