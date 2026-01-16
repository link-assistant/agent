# Case Study: Issue #123 - Badge Not Found

## Issue Summary

**Issue:** [#123 - badge not found](https://github.com/link-assistant/agent/issues/123)
**Release:** [js-v0.8.4](https://github.com/link-assistant/agent/releases/tag/js-v0.8.4)
**Date:** 2026-01-16
**Type:** Bug

The GitHub release notes for version 0.8.4 displayed a "404 badge not found" error from shields.io instead of the expected npm version badge.

## Timeline of Events

### 1. Issue #121 - Release Style Problem
**Date:** 2026-01-13

User reported that release style didn't match the template repository:
- Wrong release name format (should use `[js]` prefix)
- Wrong changelog path (should use `js/CHANGELOG.md`)
- Release descriptions lacked actual changelog content

### 2. PR #122 - Fix Implementation
**Date:** 2026-01-13 to 2026-01-16

PR #122 was created to fix issue #121. Key changes in `scripts/create-github-release.mjs`:

```javascript
// Before (line 26):
const changelogPath = prefix === 'rust-' ? './rust/CHANGELOG.md' : './CHANGELOG.md';

// After:
const changelogPath =
  prefix === 'rust-'
    ? './rust/CHANGELOG.md'
    : prefix === 'js-'
      ? './js/CHANGELOG.md'
      : './CHANGELOG.md';

// Before (line 49):
const releaseName = prefix ? `${prefix.replace(/-$/, '')} ${version}` : version;

// After:
const releaseName = prefix
  ? `[${prefix.replace(/-$/, '')}] ${version}`
  : version;
```

### 3. Release js-v0.8.4
**Date:** 2026-01-16 06:26:26Z

- PR #122 merged to main
- CI/CD pipeline triggered
- Version bump: 0.8.3 → 0.8.4
- GitHub release created with tag `js-v0.8.4`
- Release name: `[js] 0.8.4` ✅
- Changelog content: correct ✅
- NPM badge: **404 badge not found** ❌

## Root Cause Analysis

### The Bug Location

**File:** `scripts/format-github-release.mjs` (line 82)

```javascript
const tag = `${prefix}v${version}`;
// ...
await $`node scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "${tag}" ...`;
```

The `--release-version` argument receives the **full tag** (`js-v0.8.4`), not just the version (`0.8.4`).

**File:** `scripts/format-release-notes.mjs` (lines 192-193)

```javascript
const versionWithoutV = version.replace(/^v/, '');
const npmBadge = `[![npm version](https://img.shields.io/badge/npm-${versionWithoutV}-blue.svg)](...)`;
```

The regex `^v` only removes a leading `v`, so:
- Input: `js-v0.8.4`
- After `.replace(/^v/, '')`: `js-v0.8.4` (unchanged - no leading v!)
- Badge URL: `https://img.shields.io/badge/npm-js-v0.8.4-blue.svg`

### Why This Fails

Shields.io static badges use dashes (`-`) as delimiters in the URL format:

```
https://img.shields.io/badge/LABEL-MESSAGE-COLOR
```

When the version is `js-v0.8.4`, the URL becomes:
```
https://img.shields.io/badge/npm-js-v0.8.4-blue
                             ├─┘ ├┘ └─────┬──────┘
                           LABEL  │    Interpreted as COLOR
                                 MESSAGE
```

Shields.io interprets this as:
- **Label:** `npm`
- **Message:** `js`
- **Color:** `v0.8.4-blue` (invalid color!)

Result: 404 badge not found error.

### Working vs Broken URL Comparison

| URL | Result |
|-----|--------|
| `https://img.shields.io/badge/npm-0.8.4-blue.svg` | ✅ Shows `npm | 0.8.4` |
| `https://img.shields.io/badge/npm-js-v0.8.4-blue.svg` | ❌ Shows `404 | badge not found` |

### Why Template Repository Works

The template repository (`link-foundation/js-ai-driven-development-pipeline-template`) works correctly because it:
1. Uses simple version tags (`v0.3.0`) without prefix
2. The version passed to format-release-notes.mjs is just the version number

In this repository (`link-assistant/agent`):
1. Uses prefixed tags (`js-v0.8.4`, `rust-v1.0.0`) for multi-language support
2. The full tag is incorrectly passed as the version

## Proposed Solutions

### Solution 1: Pass Pure Version (Recommended)

**Change in `format-github-release.mjs`:**

```javascript
// Before (line 82):
await $`node scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "${tag}" ...`;

// After:
await $`node scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "v${version}" ...`;
```

This passes `v0.8.4` instead of `js-v0.8.4`, and the existing regex in `format-release-notes.mjs` handles the `v` prefix correctly.

### Solution 2: Update Regex in format-release-notes.mjs

**Change in `format-release-notes.mjs`:**

```javascript
// Before (line 192):
const versionWithoutV = version.replace(/^v/, '');

// After - handle both js-v and v prefixes:
const versionWithoutV = version.replace(/^(js-|rust-)?v/, '');
```

### Solution 3: URL-encode the Badge Text

If dashes must be preserved, use shields.io URL encoding (`--` for literal dash):

```javascript
const encodedVersion = versionWithoutV.replace(/-/g, '--');
const npmBadge = `[![npm version](https://img.shields.io/badge/npm-${encodedVersion}-blue.svg)](...)`;
```

### Recommended Approach

**Solution 1** is recommended because:
1. Minimal code change
2. Keeps format-release-notes.mjs simple and generic
3. The caller knows the context (prefix) and should clean it up

## Evidence and Data

### Files Collected

- `logs/release-info.json` - Release metadata from GitHub API
- `logs/pr-122-info.json` - PR #122 details and commits
- `logs/pr-122-diff.txt` - PR #122 code changes
- `logs/issue-121-details.txt` - Original issue that triggered the fix
- `logs/ci-run-21057802787.log` - CI workflow logs showing the release process
- `screenshots/badge-not-found.png` - Screenshot showing the 404 badge error

### Key Log Evidence

From CI run logs:
```
Release	Format GitHub release notes	Formatting release notes for js-v0.8.4...
Release	Format GitHub release notes	ℹ️ Found Patch Changes section
Release	Format GitHub release notes	ℹ️ Looking up PR for commit afcd2f8 (from changelog)
Release	Format GitHub release notes	✅ Found PR #122 containing commit
Release	Format GitHub release notes	   - Added shields.io npm badge  <-- Badge added but URL is wrong
```

### Badge URL Test Results

```bash
# Broken URL
$ curl -s "https://img.shields.io/badge/npm-js-v0.8.4-blue.svg" | grep -o 'aria-label="[^"]*"'
aria-label="404: badge not found"

# Working URL
$ curl -s "https://img.shields.io/badge/npm-0.8.4-blue.svg" | grep -o 'aria-label="[^"]*"'
aria-label="npm: 0.8.4"
```

## References

- [Issue #123](https://github.com/link-assistant/agent/issues/123) - This bug report
- [Issue #121](https://github.com/link-assistant/agent/issues/121) - Original style issue that triggered the buggy fix
- [PR #122](https://github.com/link-assistant/agent/pull/122) - The PR that introduced this bug
- [Release js-v0.8.4](https://github.com/link-assistant/agent/releases/tag/js-v0.8.4) - Affected release
- [Shields.io Static Badge Docs](https://shields.io/badges/static-badge) - Badge URL format specification
- [Template Repository](https://github.com/link-foundation/js-ai-driven-development-pipeline-template) - Reference implementation

## Lessons Learned

1. **Test with all prefixes:** When modifying release scripts that support multiple prefixes (js-, rust-), test all variants.
2. **Understand URL encoding:** Special characters like dashes have meaning in shields.io URLs.
3. **Trace data flow:** The bug wasn't in the modified files, but in how data flowed between scripts.
4. **Regression testing:** The fix for #121 inadvertently broke the badge because the version format changed.
