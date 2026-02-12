# Case Study: Issue #127 - Cannot convert undefined to number: toNumber error - returning NaN

## Summary

This case study documents the investigation and resolution of a debug log message that appears when using the `opencode/grok-code` model. While not a crash, the verbose debug logs show "Cannot convert undefined to number" errors for optional token fields (`cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`) that are not provided by some AI providers.

## Issue Details

- **Issue**: [#127](https://github.com/link-assistant/agent/issues/127)
- **Title**: Cannot convert undefined to number: toNumber error - returning NaN
- **Labels**: bug
- **Version**: 0.8.6
- **Related Issues**: [#119](https://github.com/link-assistant/agent/issues/119), [#125](https://github.com/link-assistant/agent/issues/125)

## Environment

| Factor | Value |
|--------|-------|
| Bun version | 1.3.6 |
| Platform | linux (Ubuntu) |
| Agent version | 0.8.6 |
| AI Model | opencode/grok-code |

## Symptoms

### Debug Log Messages

When running with `--verbose` flag, the following debug messages appear:

```json
{"context":"cachedInputTokens","valueType":"undefined","value":"undefined","error":"Cannot convert undefined to number","message":"toNumber error - returning NaN"}
{"context":"cacheWriteTokens","valueType":"undefined","value":"undefined","error":"Cannot convert undefined to number","message":"toNumber error - returning NaN"}
{"context":"reasoningTokens","valueType":"undefined","value":"undefined","error":"Cannot convert undefined to number","message":"toNumber error - returning NaN"}
```

### Raw Usage Data from Provider

The provider returns token usage in a different format:

```json
{
  "inputTokens": {"total": 12703, "noCache": 12511, "cacheRead": 192},
  "outputTokens": {"total": 562, "text": -805, "reasoning": 1367}
}
```

Note that:
- `cachedInputTokens` is `undefined` (not provided at top level)
- Cache read tokens are nested inside `inputTokens.cacheRead`
- `reasoningTokens` is `undefined` (not provided at top level)
- Reasoning tokens are nested inside `outputTokens.reasoning`

## Root Cause Analysis

### Primary Issue

The `toNumber()` function treats `undefined` as an error case, throwing an exception and returning `NaN`. While the `safeNum()` helper then converts this `NaN` to `0`, the verbose logging makes this appear as an error when it's actually expected behavior for optional fields.

### Technical Details

1. **Current `toNumber()` behavior** (lines 411-414 in `src/session/index.ts`):
   ```typescript
   if (value === undefined || value === null) {
     throw new Error(`Cannot convert ${value} to number`);
   }
   ```

2. **Why this is problematic**:
   - Many AI providers don't include optional fields like `cachedInputTokens`
   - The `toNumber()` function logs these as "errors" even though `undefined` is a valid/expected input
   - The log message "toNumber error - returning NaN" suggests something went wrong when everything is working correctly

3. **Missing data extraction**:
   - The `opencode/grok-code` provider includes `cacheRead` inside the `inputTokens` object
   - The `reasoningTokens` data exists inside `outputTokens.reasoning`
   - Currently, `getUsage()` doesn't extract these nested values

### Error Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│           AI Provider Returns Usage Data                             │
│  { inputTokens: { total: 12703, cacheRead: 192 },                   │
│    outputTokens: { total: 562, reasoning: 1367 } }                  │
│  (cachedInputTokens field is undefined/missing)                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              getUsage() calls toNumber(undefined, 'cachedInputTokens')│
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              toNumber() throws error for undefined                   │
│              Logs "toNumber error - returning NaN"                   │
│              Returns NaN                                             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              safeNum() converts NaN to 0                             │
│              (correct final result, but alarming logs)               │
└─────────────────────────────────────────────────────────────────────┘
```

## Solution

### Fix 1: Handle undefined/null gracefully in `toNumber()`

Instead of treating `undefined`/`null` as errors, return `0` directly with an informational log:

```typescript
if (value === undefined || value === null) {
  if (Flag.OPENCODE_VERBOSE) {
    log.debug(() => ({
      message: 'toNumber received undefined/null, returning 0',
      context,
      valueType: typeof value,
    }));
  }
  return 0;
}
```

### Fix 2: Extract nested cache/reasoning tokens in `getUsage()`

Add logic to extract `cacheRead` from `inputTokens` object and `reasoning` from `outputTokens` object when available:

```typescript
// Extract cacheRead from inputTokens if available (some providers nest it there)
const inputTokensObj = input.usage.inputTokens;
const nestedCacheRead = typeof inputTokensObj === 'object' && inputTokensObj !== null
  ? safeNum(toNumber((inputTokensObj as { cacheRead?: unknown }).cacheRead, 'inputTokens.cacheRead'))
  : 0;

// Use top-level cachedInputTokens if available, otherwise fall back to nested
const cachedInputTokens = safeNum(toNumber(input.usage.cachedInputTokens, 'cachedInputTokens')) || nestedCacheRead;

// Similarly for reasoning tokens from outputTokens
const outputTokensObj = input.usage.outputTokens;
const nestedReasoning = typeof outputTokensObj === 'object' && outputTokensObj !== null
  ? safeNum(toNumber((outputTokensObj as { reasoning?: unknown }).reasoning, 'outputTokens.reasoning'))
  : 0;

const reasoning = safeNum(toNumber(input.usage?.reasoningTokens, 'reasoningTokens')) || nestedReasoning;
```

## Testing

### Unit Tests to Update

1. `toNumber(undefined)` should return `0` instead of `NaN`
2. `toNumber(null)` should return `0` instead of `NaN`
3. Add tests for nested token extraction from `inputTokens.cacheRead`
4. Add tests for nested token extraction from `outputTokens.reasoning`

## Timeline

| Timestamp | Event |
|-----------|-------|
| 2026-01-21T19:00:19.814Z | Agent started with opencode/grok-code model |
| 2026-01-21T19:00:31.418Z | getUsage called with raw token data |
| 2026-01-21T19:00:31.419Z | toNumber logs "error" for cachedInputTokens (undefined) |
| 2026-01-21T19:00:31.419Z | toNumber logs "error" for cacheWriteTokens (undefined) |
| 2026-01-21T19:00:31.419Z | toNumber logs "error" for reasoningTokens (undefined) |
| 2026-01-21T19:00:31.446Z | step_finish shows tokens with cache.read: 0 (should be 192) |
| 2026-01-21T19:03:14Z | Issue #127 filed |

## Lessons Learned

1. **Optional fields should not log as errors**: When a field is expected to be optional (like `cachedInputTokens`), its absence should be handled gracefully without error-like log messages
2. **Provider data varies widely**: Different AI providers structure their token usage data differently - some nest cache/reasoning data, others provide it at the top level
3. **Debug logs affect user perception**: Even though the code works correctly (NaN is converted to 0), error-like log messages can make users think something is wrong
4. **Extract all available data**: When providers include useful data in nested structures, the code should extract it to provide accurate metrics

## Files Modified

- `js/src/session/index.ts` - Updated `toNumber()` and `getUsage()` functions
- `js/tests/session-usage.test.ts` - Updated test expectations

## References

- [GitHub Issue #127](https://github.com/link-assistant/agent/issues/127)
- [Previous fix for issue #119 (DecimalError)](./docs/case-studies/issue-119/README.md)
- [Previous fix for issue #125 (object token formats)](./docs/case-studies/issue-125/README.md)
- [AI SDK documentation on usage tracking](https://ai-sdk.dev/docs/usage)
