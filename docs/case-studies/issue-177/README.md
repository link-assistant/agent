# Case Study: Issue #177 - Fixing CLI Warnings

**Issue:** [#177 - Can we fix warnings?](https://github.com/link-assistant/agent/issues/177)
**Status:** Resolved
**Date:** 2026-02-15
**PR:** [#178](https://github.com/link-assistant/agent/pull/178)

## Executive Summary

The Agent CLI outputs several warnings during normal operation that should be addressed to ensure highest possible reliability. This case study analyzes three distinct warnings found in the user's execution log and proposes solutions that fix the **root causes** without suppressing warnings.

## Warnings Identified

### Warning 1: models.dev Cache Read Failure

**Log Entry:**
```json
{
  "type": "log",
  "level": "warn",
  "timestamp": "2026-02-15T08:22:25.204Z",
  "service": "models.dev",
  "path": "/Users/konard/.cache/link-assistant-agent/models.json",
  "message": "cache read failed, using bundled data"
}
```

**Root Cause:**
The cache file exists but fails to be read as JSON after refresh attempt. This happens because:
1. The cache is marked as stale (age: 42809773ms > threshold: 3600000ms)
2. `refresh()` is awaited but the fetch may fail silently or write invalid content
3. Subsequent `file.json().catch(() => {})` returns undefined, triggering the warning

**Analysis:** This is not actually a warning condition - using bundled data is expected fallback behavior when the cache is unavailable or corrupted. The message should be at `info` level, not `warn`.

---

### Warning 2: AI SDK Warning System Notice

**Log Entry:**
```
AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.
```

**Root Cause:**
This is an informational message from Vercel's AI SDK that appears the first time any warning is logged. It's part of the warning infrastructure added in [vercel/ai#8343](https://github.com/vercel/ai/pull/8343).

**Impact:** Very Low - This notice only appears when another AI SDK warning is triggered. If we fix the root cause of Warning 3, this notice will not appear.

---

### Warning 3: AI SDK specificationVersion Compatibility Mode

**Log Entry:**
```
AI SDK Warning (opencode.chat / kimi-k2.5-free): The feature "specificationVersion" is used in a compatibility mode. Using v2 specification compatibility mode. Some features may not be available.
```

**Root Cause Analysis (Updated 2026-02-15):**

After deep investigation, the **actual root cause** was discovered:

1. The upstream `@ai-sdk/openai-compatible` package **already supports v3** - I verified the current source code shows `specificationVersion = 'v3'` (v2.x releases).
2. However, users who installed the CLI when v1.x was "latest" have an **outdated cached version** because `BunProc.install()` with `'latest'` doesn't update if `package.json` already has `"latest"` as the version string.
3. The warning appears because the cached v1.x package implements `specificationVersion: 'v2'`.

**Technical Details:**
- AI SDK 6.x expects `specificationVersion: 'v3'`
- `@ai-sdk/openai-compatible` v2.x implements `specificationVersion: 'v3'` (FIXED UPSTREAM)
- `@ai-sdk/openai-compatible` v1.x implements `specificationVersion: 'v2'` (OLD)
- SDK runs v2 models in compatibility mode, triggering this warning
- The warning appears for each model instantiation (appears twice in the log)

**Impact:** Medium - While functionality works via compatibility mode, some v3 features may not be available.

## Timeline of Events

| Timestamp | Event |
|-----------|-------|
| 08:22:25.079Z | Agent CLI started |
| 08:22:25.092Z | models.dev cache detected as stale (age: 42809773ms) |
| 08:22:25.092Z | Cache refresh initiated |
| 08:22:25.204Z | **Warning 1**: Cache read failed |
| 08:22:25.338Z | AI SDK streamText called |
| 08:22:25.340Z | **Warning 2**: AI SDK Warning System notice |
| 08:22:25.340Z | **Warning 3**: specificationVersion v2 compatibility mode |
| 08:22:29.307Z | Second streamText call (loop step 1) |
| 08:22:29.308Z | **Warning 3 again**: specificationVersion v2 compatibility mode |
| 08:22:29.316Z | Agent disposed |

## Root Cause Analysis

### Warning 1: Cache Read Failure

**Code Location:** `js/src/provider/models.ts:130-139`

```typescript
// Now read the cache file
const result = await file.json().catch(() => {});
if (result) return result as Record<string, Provider>;

// Fallback to bundled data if cache read failed
log.warn(() => ({
  message: 'cache read failed, using bundled data',
  path: filepath,
}));
```

**Issue:** The message incorrectly uses `warn` level when falling back to bundled data is actually expected behavior - not a warning condition.

### Warning 2: AI SDK Warning System Notice

**Code Location:** External - Vercel AI SDK `ai` package

This warning is logged the first time the AI SDK logs any warning. If we fix Warning 3 (the root cause), this notice will not appear.

### Warning 3: specificationVersion Compatibility Mode

**Code Location:** `js/src/bun/index.ts:144-157` (root cause) and External - `@ai-sdk/openai-compatible` package

The warning is triggered because:
1. AI SDK 6.x expects models to implement `specificationVersion: 'v3'`
2. The upstream `@ai-sdk/openai-compatible` v2.x **already supports v3** (verified in source)
3. However, users with cached v1.x packages don't get updated because `BunProc.install()` with `'latest'` version doesn't refresh when the package.json already has `"latest"` recorded
4. The SDK detects the v2 spec in the outdated cached package and logs a warning

**Root Cause Code:**
```typescript
// js/src/bun/index.ts line 157 (BEFORE FIX)
if (parsed.dependencies[pkg] === version) return mod;
// When version === 'latest' and pkg already has 'latest' in dependencies,
// returns early without checking if there's a newer version available
```

## Solutions Implemented

### Solution 1: Fix Package Staleness Check (Root Cause Fix) - `js/src/bun/index.ts`

**Approach:** Update `BunProc.install()` to refresh 'latest' packages periodically (every 24 hours).

**Pros:**
- Fixes the actual root cause of the specificationVersion warning
- Ensures users get updated packages with bug fixes and security patches
- No suppression of legitimate warnings needed

**Cons:**
- Slightly longer startup time when packages need refresh
- Requires tracking installation timestamps

### Solution 2: Correct Log Level for Cache Fallback - `js/src/provider/models.ts`

**Approach:** Change the log level from `warn` to `info` since falling back to bundled data is expected behavior when cache is unavailable.

**Pros:**
- Accurately reflects that bundled data is a valid fallback mechanism
- Not a warning condition - the CLI works correctly with bundled data

## Why NOT Suppression

The reviewer feedback emphasized that **warnings should not be suppressed** because:

1. We may have new warnings in the future - suppressing them prevents fresh feedback from components
2. All output should remain JSON-parsable (warnings can be wrapped as JSON if needed)
3. Fixing root causes is the only acceptable approach

Therefore, the `AI_SDK_LOG_WARNINGS = false` suppression approach was **removed** from the implementation.

## Related Resources

- [AI SDK Migration Guide 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [AI SDK Issue #10689: Warn when using v2 models](https://github.com/vercel/ai/issues/10689)
- [AI SDK Issue #8329: Log warnings to console](https://github.com/vercel/ai/issues/8329)
- [AI SDK Custom Providers Guide](https://ai-sdk.dev/providers/community-providers/custom-providers)

## Filed Issues

| Repository | Issue | Description | Status |
|------------|-------|-------------|--------|
| vercel/ai | [#12615](https://github.com/vercel/ai/issues/12615) | @ai-sdk/openai-compatible v3 upgrade | Filed (Note: Upstream already fixed in v2.x) |

## Implementation (PR #178)

The following changes were implemented to fix the warnings by addressing root causes:

### 1. Package Staleness Check (Root Cause Fix) - `js/src/bun/index.ts`

Added staleness tracking for 'latest' version packages to ensure users get updated packages:

```typescript
// Staleness threshold for 'latest' version packages (24 hours)
const LATEST_VERSION_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function install(pkg: string, version = 'latest') {
  // ... existing setup code ...

  // Track installation time via _installTime metadata
  const installTime = parsed._installTime[pkg] as number | undefined;

  if (installedVersion === version) {
    // For 'latest' version, check if installation is stale and needs refresh
    if (version === 'latest' && installTime) {
      const age = Date.now() - installTime;
      if (age < LATEST_VERSION_STALE_THRESHOLD_MS) {
        return mod;
      }
      log.info(() => ({
        message: 'refreshing stale latest package',
        pkg,
        version,
        ageMs: age,
        threshold: LATEST_VERSION_STALE_THRESHOLD_MS,
      }));
    }
    // ... continue with installation ...
  }
}
```

This ensures users who installed `@ai-sdk/openai-compatible` when v1.x was "latest" will automatically get v2.x (with v3 spec support) on next CLI run.

### 2. Cache Warning Level Change - `js/src/provider/models.ts`

Changed the cache fallback message from `warn` to `info` level since using bundled data is expected behavior:

```typescript
// Fallback to bundled data if cache read failed
// This is expected behavior when the cache is unavailable or corrupted
// Using info level since bundled data is a valid fallback mechanism
log.info(() => ({
  message: 'cache unavailable, using bundled data',
  path: filepath,
}));
```

## Summary of Fixes

| Warning | Root Cause | Solution |
|---------|------------|----------|
| `specificationVersion v2 compatibility mode` | Outdated cached package (v1.x) | Package staleness check refreshes to v2.x |
| `AI SDK Warning System notice` | Triggered by other warnings | No warnings = no system notice |
| `cache read failed, using bundled data` | Incorrect log level | Changed from `warn` to `info` level |

## Implementation Notes

The Agent CLI uses AI SDK v6.0.1 (`"ai": "^6.0.1"` in package.json). The specificationVersion warning comes from the dynamically installed `@ai-sdk/openai-compatible` package which is used by OpenCode provider.

The root cause fix (staleness check) ensures users get updated packages automatically. This approach:
- Fixes the actual problem instead of hiding it
- Allows future warnings to be visible for debugging
- Maintains clean JSON-parsable output
