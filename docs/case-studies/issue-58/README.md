# Case Study: Issue #58 - Release 0.1.0 Title and PR Link Bug

## Issue Overview

**Issue:** [#58](https://github.com/link-assistant/agent/issues/58)
**Title:** Release 0.1.0 does show a title `Minor changes` and no linked pull request
**Status:** In Progress
**Created:** 2025-12-16

### Problem Statement

The release v0.1.0 shows two bugs:

1. **Incorrect Title Display:** The release notes show "### Minor Changes" as a section header, but according to project requirements, there should be NO title for major/minor/patch version releases.
2. **Missing PR Link:** The related pull request should be detected and shown in the release notes, but it is not present.

## Timeline of Events

### December 16, 2025

1. **20:24:31 UTC** - Release v0.1.0 created by github-actions[bot]
2. **20:26:20 UTC** - Release v0.1.0 published
3. **Issue reported** - User identified that release has incorrect formatting

## Data Collection

### Release Data

**Release URL:** https://github.com/link-assistant/agent/releases/tag/v0.1.0

**Release Body (Raw):**

```
### Minor Changes

- 2bcef5f: Add support for google/gemini-3-pro model alias
  - Added `google/gemini-3-pro` as an alias to `gemini-3-pro-preview`
  - Updated README.md with Google Gemini usage examples
  - Created comprehensive case study in docs/case-studies/issue-53/
  - Fixes ProviderModelNotFoundError when using google/gemini-3-pro

  This change allows users to use the commonly expected model name `gemini-3-pro` while maintaining compatibility with Google's official `gemini-3-pro-preview` identifier.
```

### CHANGELOG.md Content

The CHANGELOG.md file (lines 1-14) shows:

```markdown
# Changelog

## 0.1.0

### Minor Changes

- 2bcef5f: Add support for google/gemini-3-pro model alias
  - Added `google/gemini-3-pro` as an alias to `gemini-3-pro-preview`
  - Updated README.md with Google Gemini usage examples
  - Created comprehensive case study in docs/case-studies/issue-53/
  - Fixes ProviderModelNotFoundError when using google/gemini-3-pro

  This change allows users to use the commonly expected model name `gemini-3-pro` while maintaining compatibility with Google's official `gemini-3-pro-preview` identifier.
```

## Root Cause Analysis

### Bug #1: Incorrect "### Minor Changes" Title

**File:** `scripts/format-release-notes.mjs`
**Lines:** 92-115

The script only handles `### Patch Changes` section:

```javascript
// Extract the patch changes section
// This regex handles two formats:
// 1. With commit hash: "- abc1234: Description"
// 2. Without commit hash: "- Description"
const patchChangesMatchWithHash = currentBody.match(
  /### Patch Changes\s*\n\s*-\s+([a-f0-9]+):\s+(.+?)$/s
);
const patchChangesMatchNoHash = currentBody.match(
  /### Patch Changes\s*\n\s*-\s+(.+?)$/s
);
```

**Root Cause:**

- The script ONLY matches `### Patch Changes` sections
- When a release contains `### Minor Changes` or `### Major Changes`, the regex doesn't match
- The script exits early with "⚠️ Could not parse patch changes from release notes" (line 113)
- As a result, the formatting never happens and the "### Minor Changes" title remains in the release

### Bug #2: Missing PR Link

**Related to Bug #1**

Because the script exits early when it can't find `### Patch Changes`, it never reaches the PR detection logic (lines 136-182). Therefore:

- No commit SHA is extracted
- No PR lookup is performed
- No PR link is added to the release notes

## Comparison with Template Repository

### Template Repository Analysis

**Repository:** https://github.com/link-foundation/js-ai-driven-development-pipeline-template
**Latest Release:** v0.1.0 (2025-12-13)

The template repository has the **EXACT SAME BUG**:

```
### Minor Changes

- 65d76dc: Initial template setup with complete AI-driven development pipeline
  ...
```

The template's `scripts/format-release-notes.mjs` has identical code (lines 92-115) that only handles `### Patch Changes`.

**Conclusion:** This bug exists in the upstream template and was inherited by our repository.

## Proposed Solution

### Fix for Our Repository

Modify `scripts/format-release-notes.mjs` to:

1. **Match all changeset types** (Major, Minor, Patch)
2. **Remove the section header** (### Major Changes, ### Minor Changes, ### Patch Changes)
3. **Extract commit hash and description** from any changeset type
4. **Continue with PR detection and formatting**

### Implementation Strategy

1. Replace single regex patterns with a more flexible approach:
   - Match `### (Major|Minor|Patch) Changes` pattern
   - Extract the description regardless of the section type
   - Remove the section header entirely from the formatted output

2. Update regex patterns:

```javascript
// Match any changeset type (Major, Minor, or Patch)
const changesPattern =
  /### (Major|Minor|Patch) Changes\s*\n\s*-\s+(?:([a-f0-9]+):\s+)?(.+?)$/s;
```

3. Format output without section headers:

```javascript
// Remove "### X Changes" header entirely
const formattedBody = `${cleanDescription}`;
```

### Fix for Template Repository

Create an issue in the template repository:

- **Repository:** link-foundation/js-ai-driven-development-pipeline-template
- **Title:** Release formatting script only handles Patch changes, not Minor/Major
- **Description:** Document the bug and provide the fix

## Expected Outcomes

### After Fix

Release notes should look like:

```
Add support for google/gemini-3-pro model alias
- Added `google/gemini-3-pro` as an alias to `gemini-3-pro-preview`
- Updated README.md with Google Gemini usage examples
- Created comprehensive case study in docs/case-studies/issue-53/
- Fixes ProviderModelNotFoundError when using google/gemini-3-pro

This change allows users to use the commonly expected model name `gemini-3-pro` while maintaining compatibility with Google's official `gemini-3-pro-preview` identifier.

**Related Pull Request:** #56

---

[![npm version](https://img.shields.io/badge/npm-0.1.0-blue.svg)](https://www.npmjs.com/package/@link-assistant/agent/v/0.1.0)
```

**Key Changes:**

1. ✅ NO "### Minor Changes" header
2. ✅ Clean description starting directly with the content
3. ✅ PR link detected and shown (#56)
4. ✅ NPM badge included

## Additional Research

### Changesets Documentation

According to [@changesets/cli](https://github.com/changesets/changesets) documentation:

- Changesets generate CHANGELOG entries with section headers like "### Major Changes", "### Minor Changes", "### Patch Changes"
- These are useful for the CHANGELOG.md file to organize changes by type
- However, for GitHub Releases, these headers are redundant because:
  - The release version already indicates the type (0.1.0 is a minor version)
  - Users expect clean, concise release notes without internal categorization

### Best Practices for Release Notes

Research indicates that clean release notes should:

1. Start directly with the content (no categorization headers)
2. Include links to related PRs for context
3. Include package version badge for quick reference
4. Be formatted as clean markdown without internal structure headers

## Files Modified

1. `scripts/format-release-notes.mjs` - Fix regex patterns and remove section headers
2. `docs/case-studies/issue-58/README.md` - This case study document
3. `.changeset/fix-release-formatting.md` - Changeset for the fix

## Verification Steps

1. Run the fixed script against v0.1.0 release
2. Verify "### Minor Changes" header is removed
3. Verify PR #56 link is detected and added
4. Verify NPM badge is added
5. Check that formatting is preserved correctly
