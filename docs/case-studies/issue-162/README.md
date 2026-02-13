# Case Study: PR #161 Did Not Generate Any Release (Issue #162)

**Date**: 2026-02-13
**Issue**: [#162](https://github.com/link-assistant/agent/issues/162)
**Related PR**: [#161](https://github.com/link-assistant/agent/pull/161)
**Status**: Root cause identified - Path filter exclusion

---

## Executive Summary

PR #161 was merged to main at 22:05:37Z UTC, but no CI/CD workflow was triggered, and consequently no release was published. This document analyzes the root cause and proposes solutions.

**Root Cause**: PR #161 only modified files (`README.md` and `docs/**`) that are **excluded** from the workflow's path filters. The `js.yml` workflow only triggers on pushes to main when changes are made to `js/**`, `scripts/**`, or `.github/workflows/js.yml`.

---

## Timeline of Events

| Time (UTC)   | Event                          | Commit/SHA              | Details                                   |
| ------------ | ------------------------------ | ----------------------- | ----------------------------------------- |
| 21:20:28     | **PR #158 merged**             | `23bcfb5`               | Feature implementation with changeset     |
| 21:20:31     | Workflow run started           | Run 22003230553         | Triggered by PR #158 merge                |
| 21:22:33     | **v0.11.0 released**           | `2208d0d`               | Release for PR #158 changes               |
| 21:25:46     | PR #160 branch merged main     | `3f1ed99`               | Merge conflict resolution                 |
| 21:26:12     | Changeset added to PR #160     | `89e466d`               | Kilo Gateway changeset                    |
| 21:51:28     | **PR #160 merged**             | `0475cc8`               | Kilo Gateway provider                     |
| 21:51:41     | Workflow run started           | Run 22004080088         | Triggered by PR #160 merge                |
| 21:53:42     | **v0.12.0 released**           | `07a8998`               | Release for PR #160 changes               |
| 21:54:07     | Initial commit for PR #162     | `0da1258`               | Task file added to issue-162 branch       |
| 21:58:32     | PR #161 docs commit            | `be6c1b6`               | Case study & README comparison            |
| 22:02:06     | Revert task commit             | `fd0def9`               | Clean up task file                        |
| **22:05:37** | **PR #161 merged**             | `75b96f6`               | README + docs/case-studies only           |
| **N/A**      | **NO workflow triggered**      | N/A                     | Files not in path filter                  |
| **N/A**      | **NO release published**       | N/A                     | No changeset, no code changes             |

---

## Root Cause Analysis

### Primary Root Cause: Path Filter Exclusion

The `js.yml` workflow has path filters that limit which files trigger the workflow:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'js/**'
      - 'scripts/**'
      - '.github/workflows/js.yml'
```

PR #161 only modified the following files:
- `README.md` (root level)
- `docs/case-studies/issue-157/case-study-analysis.md`
- `docs/case-studies/issue-157/original-log.txt`

**None of these files match the path filters**, so no workflow was triggered.

### Secondary Finding: PR Split Between #158 and #161

The actual feature implementation (code + changeset) was in **PR #158**, which was merged earlier and DID trigger a release (v0.11.0). PR #161 was a **follow-up documentation PR** that only added:
- A "Why Choose Agent Over OpenCode?" section to README.md
- A detailed case study analysis document

### Why No Changeset Was Expected

PR #161 was purely documentation changes. The changeset and version bump had already been included in PR #158's release. This is actually correct behavior - documentation-only PRs don't need to trigger releases.

---

## Impact Assessment

### Actual Impact: None

Despite the initial concern, there is **no actual missing release**:

| Version | Published | Contains                                    |
| ------- | --------- | ------------------------------------------- |
| v0.11.0 | Yes       | PR #158's `--generate-title` and retry logic |
| v0.12.0 | Yes       | PR #160's Kilo Gateway provider             |

PR #161's documentation changes were informational only and did not require a release.

### Expected Behavior

The CI/CD behaved correctly:
1. Code changes trigger workflow → release happens
2. Documentation-only changes don't trigger workflow → no release needed

---

## Comparison with hive-mind Issues #1274 and #1278

The referenced hive-mind issues (#1274, #1278) describe **different problems**:

| Aspect                   | agent (Issue #162)                 | hive-mind (#1274, #1278)                        |
| ------------------------ | ---------------------------------- | ----------------------------------------------- |
| Root Cause               | Path filter exclusion              | Concurrency blocking (slow Docker ARM64 builds) |
| Workflow Triggered?      | No                                 | Yes, but stuck in pending/queued                |
| Release Expected?        | No (docs-only PR)                  | Yes (PRs had changesets)                        |
| Actual Bug?              | **No** - working as designed       | **Yes** - blocking prevented releases           |
| Fix Required?            | No (for this specific case)        | Yes - `always()` → `!cancelled()` fix           |

### Key Difference

- **hive-mind issues**: Workflow DID trigger but was blocked by concurrency rules and `always()` job conditions
- **agent issue #162**: Workflow did NOT trigger because path filters correctly excluded docs-only changes

---

## Design Considerations

While the current behavior is correct for PR #161, there are some considerations for future CI/CD design:

### Option A: Keep Current Behavior (Recommended)

**Pros:**
- Saves CI minutes by not running workflows for docs-only changes
- Prevents unnecessary npm publishes
- Standard practice in most repositories

**Cons:**
- Documentation updates may need manual release if they're critical
- README badge updates won't reflect immediately in npm

### Option B: Add README.md to Path Filters

```yaml
paths:
  - 'js/**'
  - 'scripts/**'
  - '.github/workflows/js.yml'
  - 'README.md'  # Add this
```

**Pros:**
- README updates trigger workflow
- npm package always has latest README

**Cons:**
- Unnecessary CI runs for minor README fixes
- Requires changeset for every README update (or skip release logic)

### Option C: Separate Documentation Workflow

Create a separate workflow for documentation sync:

```yaml
name: Sync README to npm
on:
  push:
    branches: [main]
    paths: ['README.md']
jobs:
  sync-readme:
    # Only update npm package README without version bump
```

**Pros:**
- README stays in sync with npm without full release
- No unnecessary version bumps

**Cons:**
- Adds complexity
- npm doesn't support updating README without publishing new version

---

## Recommendations

### For Issue #162: No Fix Needed

The CI/CD behaved correctly. PR #161 was a documentation-only PR, and the actual feature release (v0.11.0) happened via PR #158.

### For Future Improvements

1. **Document the expected behavior**: Add a comment in the workflow file explaining path filter logic
2. **Consider docs-only release workflow**: If README updates need to reflect in npm, implement Option B or C
3. **PR discipline**: When splitting PRs, include changesets with the code PR, not the docs PR

---

## Data Files

| File                                                         | Description                                  |
| ------------------------------------------------------------ | -------------------------------------------- |
| [data/timeline.json](./data/timeline.json)                   | Complete event timeline                      |
| [data/pr-161-files.json](./data/pr-161-files.json)           | Files changed in PR #161                     |
| [data/pr-158-files.json](./data/pr-158-files.json)           | Files changed in PR #158 (feature PR)        |
| [data/workflow-js.yml](./data/workflow-js.yml)               | The js.yml workflow configuration            |
| [data/recent-releases.json](./data/recent-releases.json)     | Recent releases list                         |
| [data/main-commits.json](./data/main-commits.json)           | Recent commits on main branch                |

---

## Related Case Studies

- [hive-mind Issue #1274](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-1274/README.md) - Concurrency blocking due to slow ARM64 builds
- [hive-mind Issue #1278](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-1278/README.md) - `always()` job conditions preventing workflow cancellation
- [Issue #157 Case Study](../issue-157/README.md) - The feature that PR #161 documented

---

## Conclusion

**Issue #162 is not a bug.** The CI/CD system behaved correctly by not triggering a release for a documentation-only PR. The actual feature implementation and release happened via PR #158 (v0.11.0).

The initial confusion arose from the PR split:
- PR #158: Code changes + changeset → Released as v0.11.0
- PR #161: Documentation only → No release needed

This case study serves as documentation for future reference when similar questions arise about why certain PRs don't trigger releases.
