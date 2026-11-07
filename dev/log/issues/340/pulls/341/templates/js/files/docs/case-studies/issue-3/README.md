# Case Study: Issue #3 - Release Formatting Script Only Handles Patch Changes

## Issue Overview

**Issue:** [#3](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/3)
**Title:** Release formatting script only handles Patch changes, not Minor/Major
**Status:** In Progress
**Created:** 2025-12-17

### Problem Statement

The `scripts/format-release-notes.mjs` script only handles `### Patch Changes` sections, causing it to fail on Minor and Major releases.

**Current Behavior:**

- Section headers (### Minor Changes, ### Major Changes) remain in release notes
- PR detection is skipped
- Release formatting fails silently

**Expected Behavior:**

- Release notes should be formatted cleanly without section headers
- PR detection should work for all release types
- NPM badge should be added

## Timeline of Events

### December 13, 2025

1. **Initial commit** - Template repository created with format-release-notes.mjs script
2. **Release v0.1.0 created** - First release with Minor Changes section
3. **Bug manifested** - Release shows "### Minor Changes" header and no PR link

### December 16, 2025

1. **Bug discovered in link-assistant/agent** - Issue #58 reported in downstream repository
2. **Fix implemented** - PR #59 created with solution
3. **Case study documented** - Comprehensive analysis in docs/case-studies/issue-58/

### December 17, 2025

1. **03:45 UTC** - Issue #3 created in template repository
2. **03:47 UTC** - Comment added requesting:
   - Find all repositories with same issue
   - Create issues in those repositories
   - Compile comprehensive case study in docs/case-studies/issue-3/
   - Reconstruct timeline and root causes
   - Propose solutions

## Data Collection

### Affected Repositories

Search revealed 4 repositories with the same script:

1. **link-foundation/js-ai-driven-development-pipeline-template** (this repo)
   - Path: scripts/format-release-notes.mjs
   - URL: https://github.com/link-foundation/js-ai-driven-development-pipeline-template

2. **link-foundation/test-anywhere**
   - Path: scripts/format-release-notes.mjs
   - URL: https://github.com/link-foundation/test-anywhere

3. **link-foundation/gh-download-pull-request**
   - Path: scripts/format-release-notes.mjs
   - URL: https://github.com/link-foundation/gh-download-pull-request

4. **link-foundation/gh-download-issue**
   - Path: scripts/format-release-notes.mjs
   - URL: https://github.com/link-foundation/gh-download-issue

### Release v0.1.0 Data

**Release:** https://github.com/link-foundation/js-ai-driven-development-pipeline-template/releases/tag/v0.1.0

**Current Body (Problematic):**

```markdown
### Minor Changes

- 65d76dc: Initial template setup with complete AI-driven development pipeline

  Features:
  - Multi-runtime support for Node.js, Bun, and Deno
  - Universal testing with test-anywhere framework
  - Automated release workflow with changesets
  - GitHub Actions CI/CD pipeline with 9 test combinations
  - Code quality tools: ESLint + Prettier with Husky pre-commit hooks
  - Package manager agnostic design
```

**CHANGELOG.md Content:**

```markdown
## 0.1.0

### Minor Changes

- 65d76dc: Initial template setup with complete AI-driven development pipeline

  Features:
  - Multi-runtime support for Node.js, Bun, and Deno
  - Universal testing with test-anywhere framework
  - Automated release workflow with changesets
  - GitHub Actions CI/CD pipeline with 9 test combinations
  - Code quality tools: ESLint + Prettier with Husky pre-commit hooks
  - Package manager agnostic design
```

## Root Cause Analysis

### Bug #1: Incorrect Section Header Remaining

**File:** `scripts/format-release-notes.mjs`
**Lines:** 92-115

The script only matches `### Patch Changes` sections:

```javascript
const patchChangesMatchWithHash = currentBody.match(
  /### Patch Changes\s*\n\s*-\s+([a-f0-9]+):\s+(.+?)$/s
);
const patchChangesMatchNoHash = currentBody.match(
  /### Patch Changes\s*\n\s*-\s+(.+?)$/s
);
```

**Root Cause:**

- The regex pattern is hardcoded to only match `### Patch Changes`
- When a release contains `### Minor Changes` or `### Major Changes`, the pattern doesn't match
- Script exits early with warning message (line 113)
- Section header remains in the release notes unprocessed

### Bug #2: Missing PR Link

**Related to Bug #1**

Because the script exits early when it can't parse the changes section:

- Commit hash is never extracted (lines 106-115)
- PR detection logic is never reached (lines 136-182)
- No PR link is added to release notes

### Bug #3: Missing NPM Badge

**Related to Bug #1**

The NPM badge formatting (lines 184-195) is also never reached:

- Script exits before building formatted body
- No shields.io badge is added

## Comparison with Changesets Default Behavior

### Changesets CHANGELOG Format

Changesets CLI generates CHANGELOG.md with section headers for organizational purposes:

- `### Major Changes` - Breaking changes (X.0.0)
- `### Minor Changes` - New features (0.X.0)
- `### Patch Changes` - Bug fixes (0.0.X)

**Sources:**

- [Changesets GitHub Repository](https://github.com/changesets/changesets)
- [Changesets Detailed Documentation](https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md)
- [NPM Package](https://www.npmjs.com/package/@changesets/cli)
- [LogRocket Guide to Changesets](https://blog.logrocket.com/version-management-changesets/)

### Why This is a Problem for GitHub Releases

1. **CHANGELOG.md vs GitHub Releases** - Section headers are useful in CHANGELOG.md for organizing multiple version entries, but redundant in individual GitHub Releases
2. **Version already indicates type** - A v0.1.0 release is clearly a minor version; the "### Minor Changes" header is redundant
3. **User expectations** - GitHub Release notes should be clean, concise, and focused on content, not categorization

## Reference Implementation

### link-assistant/agent Fix

The bug was already fixed in a downstream repository:

- **Repository:** link-assistant/agent
- **Issue:** [#58](https://github.com/link-assistant/agent/issues/58)
- **Pull Request:** [#59](https://github.com/link-assistant/agent/pull/59)
- **Case Study:** docs/case-studies/issue-58/README.md

### The Solution

Replace hardcoded `### Patch Changes` regex with flexible pattern matching:

```javascript
// Match any changeset type (Major, Minor, or Patch)
const changesPattern =
  /### (Major|Minor|Patch) Changes\s*\n\s*-\s+(?:([a-f0-9]+):\s+)?(.+?)$/s;
const changesMatch = currentBody.match(changesPattern);

let commitHash = null;
let rawDescription = null;
let changeType = null;

if (changesMatch) {
  // Extract: [full match, changeType, commitHash (optional), description]
  [, changeType, commitHash, rawDescription] = changesMatch;
  console.log(`ℹ️ Found ${changeType} Changes section`);

  // If commitHash is undefined and description contains it, try to extract
  if (!commitHash && rawDescription) {
    const descWithHashMatch = rawDescription.match(/^([a-f0-9]+):\s+(.+)$/s);
    if (descWithHashMatch) {
      [, commitHash, rawDescription] = descWithHashMatch;
    }
  }
} else {
  console.log('⚠️ Could not parse changes from release notes');
  console.log('   Looking for pattern: ### [Major|Minor|Patch] Changes');
  process.exit(0);
}
```

**Key Improvements:**

1. Uses capture group `(Major|Minor|Patch)` to match all changeset types
2. Makes commit hash optional with non-capturing group `(?:...)?`
3. Handles both formats: with and without commit hash
4. Provides informative logging for debugging
5. Continues to PR detection and formatting instead of exiting early

## Proposed Solution

### Implementation Steps

1. **Update regex pattern** in scripts/format-release-notes.mjs:92-115
   - Replace hardcoded "Patch Changes" with flexible "(Major|Minor|Patch) Changes"
   - Handle optional commit hash in single regex
   - Add fallback extraction for embedded commit hashes

2. **Test all changeset types:**
   - Create test script for Major changes
   - Create test script for Minor changes
   - Create test script for Patch changes

3. **Verify expected outcomes:**
   - Section headers removed
   - PR detection works for all types
   - NPM badge added
   - Formatting preserved

### Expected Results

**After Fix - Release Notes Format:**

```markdown
Initial template setup with complete AI-driven development pipeline

Features:

- Multi-runtime support for Node.js, Bun, and Deno
- Universal testing with test-anywhere framework
- Automated release workflow with changesets
- GitHub Actions CI/CD pipeline with 9 test combinations
- Code quality tools: ESLint + Prettier with Husky pre-commit hooks
- Package manager agnostic design

**Related Pull Request:** #X

---

[![npm version](https://img.shields.io/badge/npm-0.1.0-blue.svg)](https://www.npmjs.com/package/my-package/v/0.1.0)
```

**Key Changes:**

1. ✅ NO "### Minor Changes" header
2. ✅ Clean description starting directly with content
3. ✅ PR link detected and shown
4. ✅ NPM badge included
5. ✅ Proper formatting with separator

## Impact Assessment

### Affected Releases

**In this repository:**

- v0.1.0 - Minor release with formatting bug

**In downstream repositories:**

- All Minor and Major releases fail formatting
- Patch releases work correctly

### Risk Analysis

**Low Risk Fix:**

- Script already handles edge cases for commit hash extraction
- Only expanding pattern matching, not changing logic
- Backward compatible with Patch changes
- Already tested and proven in link-assistant/agent#59

## Next Steps

1. ✅ Create comprehensive case study (this document)
2. ⏳ Create issues in affected repositories:
   - link-foundation/test-anywhere
   - link-foundation/gh-download-pull-request
   - link-foundation/gh-download-issue
3. ⏳ Implement fix in this repository
4. ⏳ Create test scripts to validate all changeset types
5. ⏳ Run local CI checks before committing
6. ⏳ Update PR with solution details
7. ⏳ Mark PR as ready for review

## Files Modified

1. `scripts/format-release-notes.mjs` - Implement flexible pattern matching
2. `docs/case-studies/issue-3/README.md` - This case study
3. `experiments/test-format-release-notes-*.mjs` - Test scripts for validation

## Verification Steps

1. Test script against mock Major changes
2. Test script against mock Minor changes
3. Test script against mock Patch changes
4. Verify all three types:
   - Remove section headers
   - Extract commit hash
   - Detect and link PR
   - Add NPM badge
   - Preserve formatting

## References

- [Changesets GitHub](https://github.com/changesets/changesets)
- [Changesets Documentation](https://github.com/changesets/changesets/blob/main/docs/detailed-explanation.md)
- [Reference Fix PR](https://github.com/link-assistant/agent/pull/59)
- [Original Issue](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/3)
