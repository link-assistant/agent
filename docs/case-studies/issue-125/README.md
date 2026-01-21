# Case Study: Issue #125 - Invalid input: expected string, received object

## Summary

This case study documents the investigation and resolution of a platform-specific bug where the agent CLI would crash with a Zod validation error on Ubuntu servers but work correctly on macOS.

## Issue Details

- **Issue**: [#125](https://github.com/link-assistant/agent/issues/125)
- **Title**: Invalid input: expected string, received object
- **Labels**: bug
- **Version**: 0.8.5

## Environment Comparison

| Factor | macOS (Working) | Ubuntu (Failing) |
|--------|-----------------|------------------|
| Bun version | 1.2.20 | 1.3.6 |
| Platform | darwin | linux |
| AI SDK version | 6.0.0-beta.99 | 6.0.0-beta.99 |

## Symptoms

### Error Message

```
ZodError: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": ["finish"],
    "message": "Invalid input: expected string, received object"
  }
]
```

### Verbose Logging Shows

On Ubuntu (Bun 1.3.6):
```json
{
  "context": "inputTokens",
  "valueType": "object",
  "value": "{\"total\":8707,\"noCache\":6339,\"cacheRead\":2368}",
  "error": "Conversion to number resulted in NaN"
}
```

On macOS (Bun 1.2.20):
```json
{
  "context": "inputTokens",
  "valueType": "number",
  "value": "8707"
}
```

## Root Cause Analysis

### Primary Issues

1. **Token Count Format Difference**: Different Bun versions (or underlying platform differences) cause the AI SDK to return token counts in different formats:
   - macOS: Plain numbers (`inputTokens: 8707`)
   - Ubuntu: Objects with nested structure (`inputTokens: { total: 8707, noCache: 6339, cacheRead: 2368 }`)

2. **finishReason Format Difference**: The `finishReason` field was similarly affected:
   - macOS: Plain string (`"stop"`)
   - Ubuntu: Object (`{ unified: "tool-calls", raw: "tool_calls" }`)

### Technical Details

The issue occurred in two places:

1. **`src/session/index.ts` - `toNumber()` function**: The function used `Number(value)` which returns `NaN` for objects, causing token counts to be incorrectly set to 0.

2. **`src/session/processor.ts` - finish-step handling**: The code directly assigned `value.finishReason` to schema fields expecting strings, causing Zod validation to fail when it received an object.

### Related Issues

- AI SDK Issue [#10291](https://github.com/vercel/ai/issues/10291): Type validation error on finish event in v6.0.0-beta.99
- This is a known schema mismatch between server and client in the AI SDK beta

## Solution

### Fix 1: Enhanced `toNumber()` Function

Added logic to extract the `total` field from objects:

```typescript
// Handle objects with a 'total' field
if (
  typeof value === 'object' &&
  value !== null &&
  'total' in value &&
  typeof (value as { total: unknown }).total === 'number'
) {
  const result = (value as { total: number }).total;
  return result;
}
```

### Fix 2: New `toFinishReason()` Function

Added a helper function to safely convert `finishReason` to a string:

```typescript
export const toFinishReason = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return 'unknown';

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.type === 'string') return obj.type;
    if (typeof obj.finishReason === 'string') return obj.finishReason;
    if (typeof obj.reason === 'string') return obj.reason;
    return JSON.stringify(value);
  }

  return String(value);
};
```

### Fix 3: Updated `processor.ts`

Used the new `toFinishReason()` function in the finish-step handler:

```typescript
const finishReason = Session.toFinishReason(value.finishReason);
input.assistantMessage.finish = finishReason;
```

## Testing

Added comprehensive tests in `tests/session-usage.test.ts`:

1. Tests for `toNumber()` with objects containing `total` field
2. Tests for `toFinishReason()` with various input types (string, object, null, undefined)
3. Integration tests for `getUsage()` with object token formats

All 69 tests pass.

## Timeline

1. User reports issue with Ubuntu server (Bun 1.3.6) while macOS (Bun 1.2.20) works
2. Investigation reveals AI SDK returns different data structures across platforms
3. Root cause identified: missing handling for object-formatted token counts and finish reasons
4. Fix implemented with backward-compatible handling of both formats
5. Tests added to prevent regression

## Lessons Learned

1. **Cross-platform testing**: Different runtimes/versions can cause subtle data structure differences
2. **Defensive parsing**: When consuming external API data, always handle unexpected formats gracefully
3. **Verbose logging**: The existing verbose logging infrastructure made debugging straightforward
4. **AI SDK beta instability**: Beta versions of AI SDK may have schema inconsistencies

## Files Modified

- `js/src/session/index.ts` - Enhanced `toNumber()`, added `toFinishReason()`
- `js/src/session/processor.ts` - Updated finish-step handling
- `js/tests/session-usage.test.ts` - Added new test cases

## References

- [AI SDK 6.0 Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
- [Vercel AI SDK Issue #10291](https://github.com/vercel/ai/issues/10291)
- [Previous related fix for issue #119](https://github.com/link-assistant/agent/issues/119)
