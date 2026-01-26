# Case Study: Issue #96 - Undefined is not an object (evaluating 'Log.Default.lazy.info')

## Issue Summary

**Title:** undefined is not an object (evaluating 'Log.Default.lazy.info')
**Issue URL:** https://github.com/link-assistant/agent/issues/96
**Reporter:** @konard
**Date:** 2025-12-22
**Labels:** bug
**Status:** ✅ **CLOSED** (Fixed in PRs #97 and #98)

## Problem Description

When running the agent CLI with a model, users encounter the following error:

```
$ echo "hi" | agent --model opencode/gemini-3-pro
{
  "type": "status",
  "mode": "stdin-stream",
  "message": "Agent CLI in continuous listening mode. Accepts JSON and plain text input.",
  "hint": "Press CTRL+C to exit. Use --help for options.",
  "acceptedFormats": [
    "JSON object with \"message\" field",
    "Plain text"
  ],
  "options": {
    "interactive": true,
    "autoMergeQueuedMessages": true,
    "alwaysAcceptStdin": true,
    "compactJson": false
  }
}
undefined is not an object (evaluating 'Log.Default.lazy.info')
```

The error occurs immediately after the status message is displayed, preventing any further processing.

## Root Cause Analysis

### Investigation

The error message indicates that `Log.Default.lazy` is `undefined`, and attempting to access `.info()` on it fails.

### Code Location

The problematic code is found in `src/index.js` at lines 250, 258, 321, and 329:

**Line 250 (runAgentMode function):**

```javascript
Log.Default.lazy.info(() => ({
  message: 'Agent started',
  version: pkg.version,
  command: process.argv.join(' '),
  workingDirectory: process.cwd(),
  scriptPath: import.meta.path,
}));
```

**Line 258 (runAgentMode function):**

```javascript
if (Flag.OPENCODE_DRY_RUN) {
  Log.Default.lazy.info(() => ({
    message: 'Dry run mode enabled',
    mode: 'dry-run',
  }));
}
```

**Line 321 (runContinuousAgentMode function):**

```javascript
Log.Default.lazy.info(() => ({
  message: 'Agent started (continuous mode)',
  version: pkg.version,
  command: process.argv.join(' '),
  workingDirectory: process.cwd(),
  scriptPath: import.meta.path,
}));
```

**Line 329 (runContinuousAgentMode function):**

```javascript
if (Flag.OPENCODE_DRY_RUN) {
  Log.Default.lazy.info(() => ({
    message: 'Dry run mode enabled',
    mode: 'dry-run',
  }));
}
```

### Root Cause

The `Log.Default` object does NOT have a `.lazy` property. Looking at `src/util/log.ts`:

1. **Log.Default** is created at line 81: `export const Default = create({ service: 'default' });`
2. The `Logger` type (lines 49-77) defines methods: `debug()`, `info()`, `warn()`, `error()`, `tag()`, `clone()`, `time()`
3. **There is no `.lazy` property** defined on the Logger type or the returned logger object

The lazy logging functionality is already built into the logging methods themselves. Looking at lines 264-278:

```typescript
info(message?: any, extra?: Record<string, any>) {
  if (!shouldLog('INFO')) return;

  // Check if message is a function (lazy logging)
  if (typeof message === 'function') {
    lazyLogInstance.info(() => {
      const data = message();
      const { message: msg, ...extraData } = data;
      output('INFO', msg, extraData);
      return '';
    });
  } else {
    output('INFO', message, extra);
  }
}
```

The Logger's `info()` method (and other log methods) directly accepts callback functions for lazy evaluation. The `.lazy` intermediate property was never implemented.

### Correct Usage Pattern

The code should use:

```javascript
Log.Default.info(() => ({ message: 'Agent started', ... }))
```

Instead of:

```javascript
Log.Default.lazy.info(() => ({ message: 'Agent started', ... }))
```

## Reference Implementations

### Existing Correct Usage in Codebase

**src/util/eventloop.ts (line 11):**

```typescript
Log.Default.info('eventloop', { active });
```

**src/project/bootstrap.ts (line 12):**

```typescript
Log.Default.info('bootstrapping', { directory: Instance.directory });
```

**src/project/instance.ts (lines 23, 59, 63):**

```typescript
Log.Default.info('creating instance', { directory: input.directory });
Log.Default.info('disposing instance', { directory: Instance.directory });
Log.Default.info('disposing all instances');
```

**src/provider/echo.ts (lines 68, 95):**

```typescript
log.info('echo generate', { modelId, echoText });
log.info('echo stream', { modelId, echoText });
```

### Alternative: Standalone Lazy Logger (src/util/log-lazy.ts)

A separate lazy logging module exists but is NOT what `Log.Default` uses:

```typescript
import { lazyLog } from './util/log-lazy.ts';

lazyLog.info(() => 'message');
lazyLog.debug(() => ({ action: 'fetch', url: someUrl }));
```

This is an alternative implementation for explicit lazy-only logging, but is independent from `Log.Default`.

## Solution

### Before (Broken)

```javascript
Log.Default.lazy.info(() => ({
  message: 'Agent started',
  version: pkg.version,
  // ...
}));
```

### After (Fixed)

```javascript
Log.Default.info(() => ({
  message: 'Agent started',
  version: pkg.version,
  // ...
}));
```

Simply remove `.lazy` from all four occurrences since the lazy evaluation is already built into the `Log.Default.info()` method.

## Timeline

1. **2025-12-22:** Issue reported by @konard
2. **2025-12-22:** Root cause identified - non-existent `.lazy` property on `Log.Default`
3. **2025-12-22:** Fix implemented - removed `.lazy` from all four occurrences
4. **2025-12-22:** Fix verified - agent runs without logging errors for both normal and dry-run modes

## Lessons Learned

1. **API Documentation:** When implementing logging utilities, clearly document the available methods and their signatures
2. **Type Safety:** TypeScript types for `Logger` correctly showed that `.lazy` wasn't a property, but JavaScript usage didn't catch the error
3. **Testing:** The logging code paths weren't covered by existing tests, allowing this bug to slip through
4. **Code Review:** Changes to shared utilities (logging) should be carefully reviewed for API compatibility

## Prevention

1. **Add Unit Test:** Add a test to verify `Log.Default.info()` accepts callback functions for lazy evaluation ✅ **COMPLETED** - Added tests in `tests/log-lazy.test.js`
2. **CI/CD Test:** Use `--model link-assistant/echo` in CI/CD tests to catch similar runtime errors without incurring API costs ✅ **COMPLETED** - Added test in `tests/dry-run.test.js`
3. **Type Checking:** Ensure TypeScript is run during the build process to catch undefined property access

## Additional Robustness Improvements

To ensure the lazy property is always available across different JavaScript engines and execution environments, the logger implementation was further improved:

### Object.defineProperty for Lazy Property

**File:** `src/util/log.ts` (line 338-342)

**Before:**

```typescript
// Add lazy property for backward compatibility
(result as any).lazy = result;
```

**After:**

```typescript
// Add lazy property for backward compatibility
// Use Object.defineProperty to ensure it's always available
Object.defineProperty(result, 'lazy', {
  get() {
    return result;
  },
  enumerable: false,
  configurable: false,
});
```

**Rationale:**

- Ensures the `lazy` property is always accessible, even in strict JavaScript environments
- Prevents the property from being accidentally overwritten or deleted
- Provides consistent behavior across different module loading scenarios

## Testing Results

After implementing the fix, the following scenarios were tested and verified to work without the logging error:

### ✅ Original Issue Scenario

```bash
echo "hi" | agent --model opencode/gemini-3-pro
```

- **Result:** Agent starts and responds correctly without any logging errors
- **Output:** "Hi! How can I help you today?"

### ✅ Dry Run Mode

```bash
echo "hi" | agent --model link-assistant/echo --dry-run --no-always-accept-stdin
```

- **Result:** Dry run mode works without logging errors
- **Output:** "hi" (echoed back, no API cost incurred)

### ✅ Link-Assistant Echo Model (Recommended for CI/CD)

```bash
echo "test" | agent --model link-assistant/echo --no-always-accept-stdin
```

- **Result:** Works perfectly without any logging errors
- **Benefits:** Zero cost, predictable behavior, ideal for automated testing

### ✅ Continuous Mode with Verbose Logging

```bash
echo "hi" | agent --model link-assistant/echo --verbose
```

- **Result:** Continuous mode starts successfully with proper JSON logging output
- **Output:** Structured JSON logs showing "Agent started (continuous mode)" message

### ✅ Unit Tests

- **`tests/log-lazy.test.js`:** All 19 tests pass ✅
- **`tests/dry-run.test.js`:** Tests include verification that `Log.Default.lazy.info` does NOT appear in stderr ✅
- **CI/CD Integration:** Release workflow runs `tests/dry-run.test.js` which includes echo model regression tests ✅

## Case Study Data Files

This case study includes the following data files for comprehensive analysis:

- **`issue-data.json`**: Complete GitHub issue data including timeline and metadata
- **`pr-97-data.json`**: Pull request information with commits and changes
- **`test-verification.log`**: Test output demonstrating the fix works correctly
- **`web-research-findings.md`**: Research on similar logging issues and JavaScript lazy evaluation patterns

## Final Status

**Issue Status:** ✅ **CLOSED** (Merged in PRs #97 and #98)

- Root cause identified and fixed
- Additional robustness improvements implemented
- Comprehensive testing completed
- Regression prevention measures implemented
- Case study documentation created
- CI/CD integration verified

The logging system now works correctly across all code paths and the `link-assistant/echo` model is available for safe, cost-free testing in CI/CD environments.
