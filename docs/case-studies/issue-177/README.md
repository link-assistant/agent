# Case Study: Issue #177 - Fixing CLI Warnings

**Issue:** [#177 - Can we fix warnings?](https://github.com/link-assistant/agent/issues/177)
**Status:** Resolved
**Date:** 2026-02-15
**PR:** [#178](https://github.com/link-assistant/agent/pull/178)

## Executive Summary

The Agent CLI outputs several warnings during normal operation that should be addressed to ensure highest possible reliability. This case study analyzes three distinct warnings found in the user's execution log and proposes solutions.

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

**Impact:** Low - Falls back to bundled data, but indicates potential cache corruption or network issues.

---

### Warning 2: AI SDK Warning System Notice

**Log Entry:**
```
AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.
```

**Root Cause:**
This is an informational message from Vercel's AI SDK that appears the first time any warning is logged. It's part of the warning infrastructure added in [vercel/ai#8343](https://github.com/vercel/ai/pull/8343).

**Impact:** Very Low - This is purely informational and appears only once per session.

---

### Warning 3: AI SDK specificationVersion Compatibility Mode

**Log Entry:**
```
AI SDK Warning (opencode.chat / kimi-k2.5-free): The feature "specificationVersion" is used in a compatibility mode. Using v2 specification compatibility mode. Some features may not be available.
```

**Root Cause:**
The AI SDK v6 uses `specificationVersion: 'v3'` but the OpenCode provider (`@ai-sdk/openai-compatible`) returns a model using the older `v2` specification. This triggers a compatibility warning added in [vercel/ai#10770](https://github.com/vercel/ai/pull/10770).

**Technical Details:**
- AI SDK 6.x expects `specificationVersion: 'v3'`
- The `@ai-sdk/openai-compatible` provider package implements `specificationVersion: 'v2'`
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

**Issue:** The `refresh()` function doesn't guarantee a valid cache file exists after it returns. The `fetch` may fail silently, or the file may be corrupted.

### Warning 2: AI SDK Warning System Notice

**Code Location:** External - Vercel AI SDK `ai` package

This warning is logged the first time the AI SDK logs any warning. It's informational to help users understand they can disable warnings.

### Warning 3: specificationVersion Compatibility Mode

**Code Location:** External - `@ai-sdk/openai-compatible` package

The warning is triggered because:
1. AI SDK 6.x expects models to implement `specificationVersion: 'v3'`
2. `@ai-sdk/openai-compatible` still implements `specificationVersion: 'v2'`
3. The SDK detects this mismatch and logs a warning

## Proposed Solutions

### Solution 1: Suppress Cache Warning (Internal)

**Approach:** Change the log level from `warn` to `info` since falling back to bundled data is expected behavior when cache is unavailable.

**Pros:**
- Simple change
- No external dependencies
- Bundled data fallback is a valid fallback mechanism

**Cons:**
- Doesn't fix the underlying cache read issue

### Solution 2: Fix Cache Write/Read Race Condition (Internal)

**Approach:** Ensure cache file is valid JSON before completing refresh.

**Pros:**
- Fixes root cause
- Prevents future cache corruption issues

**Cons:**
- More complex implementation

### Solution 3: Suppress AI SDK Warnings (Internal)

**Approach:** Set `globalThis.AI_SDK_LOG_WARNINGS = false` at startup.

**Pros:**
- Simple one-line fix
- Removes all AI SDK warning noise

**Cons:**
- May hide legitimate warnings
- Should be configurable rather than always suppressed

### Solution 4: Report Issue to Vercel AI SDK (External)

**Approach:** File an issue to request `@ai-sdk/openai-compatible` be updated to v3 specification.

**Pros:**
- Fixes root cause upstream
- Benefits all users of the package

**Cons:**
- Dependent on external timeline
- May take time to be released

## Recommended Implementation

1. **Immediate:** Suppress AI SDK warnings via environment variable or global flag
2. **Short-term:** Improve cache error handling with better fallback messaging
3. **Long-term:** File issue with Vercel AI SDK for specificationVersion upgrade

## Related Resources

- [AI SDK Migration Guide 5.x to 6.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [AI SDK Issue #10689: Warn when using v2 models](https://github.com/vercel/ai/issues/10689)
- [AI SDK Issue #8329: Log warnings to console](https://github.com/vercel/ai/issues/8329)
- [AI SDK Custom Providers Guide](https://ai-sdk.dev/providers/community-providers/custom-providers)

## Filed Issues

| Repository | Issue | Description | Status |
|------------|-------|-------------|--------|
| vercel/ai | [#12615](https://github.com/vercel/ai/issues/12615) | @ai-sdk/openai-compatible v3 upgrade | Filed |

## Implementation (PR #178)

The following changes were implemented to fix the warnings:

### 1. AI SDK Warning Suppression (`js/src/flag/flag.ts`)

Added `Flag.initAISDKWarnings()` function that suppresses AI SDK warnings by default:

```typescript
export function initAISDKWarnings(): void {
  const enableWarnings = truthy('AGENT_ENABLE_AI_SDK_WARNINGS');
  if (!enableWarnings && (globalThis as any).AI_SDK_LOG_WARNINGS === undefined) {
    (globalThis as any).AI_SDK_LOG_WARNINGS = false;
  }
}
```

Users can re-enable warnings by setting `AGENT_ENABLE_AI_SDK_WARNINGS=true`.

### 2. Early Initialization (`js/src/index.js`)

Call `Flag.initAISDKWarnings()` at the very start of the CLI, before any AI SDK imports:

```javascript
import { Flag } from './flag/flag.ts';

// Initialize AI SDK warning suppression early
Flag.initAISDKWarnings();
```

### 3. Cache Warning Level Change (`js/src/provider/models.ts`)

Changed the cache fallback message from `warn` to `info` level since using bundled data is expected behavior:

```typescript
log.info(() => ({
  message: 'cache unavailable, using bundled data',
  path: filepath,
}));
```

## Implementation Notes

The Agent CLI uses AI SDK v6.0.1 (`"ai": "^6.0.1"` in package.json). The specificationVersion warning comes from the dynamically installed `@ai-sdk/openai-compatible` package which is used by OpenCode provider.

The echo and cache providers already correctly implement `specificationVersion: 'v2'` in their model implementations, but since they are internal synthetic providers, they don't trigger the external warning.
