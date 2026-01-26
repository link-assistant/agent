# Case Study: Issue #129 - Agent Does Not Continue Working on Task

## Summary

**Issue**: The AI agent stops working after executing a single tool call, even when more work is required.
**Root Cause**: The `toFinishReason` function fails to properly extract the finish reason from an object with `unified` and `raw` fields, causing the loop exit condition to trigger incorrectly.
**Severity**: Critical - Renders the agent non-functional for multi-step tasks.
**Version Affected**: 0.8.7

## Timeline of Events

Based on the verbose logs provided in the issue:

| Timestamp | Event | Details |
|-----------|-------|---------|
| 15:35:13.299Z | Agent started | Version 0.8.7, model: opencode/grok-code |
| 15:35:13.332Z | Session created | Session ID: ses_419a7934bffe0h1neosj3qTqh7 |
| 15:35:13.357Z | Loop step 0 | Initial loop iteration begins |
| 15:35:13.506Z | Processor starts | Model invocation begins |
| 15:35:15.303Z | Step starts | First step begins, snapshot taken |
| 15:35:18.609Z | Tool call completed | `gh issue view --repo veb86/GristWidgets 8` executed |
| 15:35:18.612Z | **BUG TRIGGERED** | `toFinishReason` receives `{"unified":"tool-calls","raw":"tool_calls"}` |
| 15:35:18.612Z | JSON fallback | Cannot extract string, returns JSON string |
| 15:35:18.631Z | Step finishes | Reason stored as `"{\"unified\":\"tool-calls\",\"raw\":\"tool_calls\"}"` |
| 15:35:18.654Z | Loop step 1 | Second loop iteration begins |
| 15:35:18.657Z | **PREMATURE EXIT** | Loop exits - condition `finish !== 'tool-calls'` triggers |
| 15:35:18.735Z | Instance disposed | Agent terminates unexpectedly |

**Total execution time**: ~5.4 seconds
**Expected behavior**: Agent should continue to process tool results and make further model calls.
**Actual behavior**: Agent exits after single tool call.

## Root Cause Analysis

### The Bug Location

**File**: `js/src/session/index.ts`
**Function**: `toFinishReason` (lines 494-562)

### The Problem

When the AI SDK returns a finish reason, it may come as an object with the following structure:
```json
{
  "unified": "tool-calls",
  "raw": "tool_calls"
}
```

The `toFinishReason` function is designed to extract a string from various input formats:
1. Direct string (returns as-is)
2. Object with `type` field
3. Object with `finishReason` field
4. Object with `reason` field
5. Fallback: JSON.stringify()

The bug is that the AI SDK (specifically opencode provider) returns finish reasons with `unified` and `raw` fields, which are NOT handled by the extraction logic. This causes the function to fall through to the JSON.stringify fallback.

### Code Path

```typescript
// File: js/src/session/index.ts, line 494-562
export const toFinishReason = (value: unknown): string => {
  // ... string check ...
  // ... null/undefined check ...

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Tries: obj.type, obj.finishReason, obj.reason
    // MISSING: obj.unified (the actual field name!)

    // Fallback - THIS IS TRIGGERED
    return JSON.stringify(value); // Returns '{"unified":"tool-calls","raw":"tool_calls"}'
  }
  // ...
};
```

### The Exit Condition

**File**: `js/src/session/prompt.ts` (lines 275-282)

```typescript
if (
  lastAssistant?.finish &&
  lastAssistant.finish !== 'tool-calls' &&  // FAILS: '{"unified":...}' !== 'tool-calls'
  lastUser.id < lastAssistant.id
) {
  log.info(() => ({ message: 'exiting loop', sessionID }));
  break;  // Loop exits prematurely
}
```

When `lastAssistant.finish` is `'{"unified":"tool-calls","raw":"tool_calls"}'`, the comparison `!== 'tool-calls'` evaluates to `true`, causing the loop to exit.

## Impact

1. **Agent becomes non-functional** for any task requiring multiple tool calls
2. **User frustration** as tasks are abandoned mid-execution
3. **Wasted resources** as partial work is lost
4. **Provider-specific issue** - Only affects providers returning finish reasons as objects with `unified`/`raw` fields

## Solution

### Fix #1: Handle `unified` field in `toFinishReason`

Add handling for the `unified` field before the JSON.stringify fallback:

```typescript
if (typeof obj.unified === 'string') {
  return obj.unified;
}
```

This is the recommended fix as it:
- Directly addresses the root cause
- Maintains backward compatibility
- Is minimal and focused

### Fix #2 (Alternative): Normalize comparison in loop exit condition

Modify the exit condition to handle JSON-encoded finish reasons:

```typescript
// Parse finish reason if it looks like JSON
const normalizedFinish = lastAssistant.finish?.startsWith('{')
  ? JSON.parse(lastAssistant.finish).unified ?? lastAssistant.finish
  : lastAssistant.finish;

if (
  normalizedFinish &&
  normalizedFinish !== 'tool-calls' &&
  lastUser.id < lastAssistant.id
) {
  break;
}
```

This is NOT recommended as it:
- Adds complexity to multiple code paths
- Doesn't fix the root cause (finish reason storage)
- May have performance implications

## Testing Strategy

1. **Unit test** for `toFinishReason` with `{unified, raw}` object input
2. **Integration test** simulating opencode provider responses
3. **End-to-end test** with multi-step task execution

## Related Issues and References

- Issue #125: Initial `toFinishReason` implementation
- AI SDK documentation on finish reasons
- OpenAI-compatible provider specifications

## Lessons Learned

1. **Defensive parsing**: When handling third-party API responses, consider all possible field names
2. **Logging is essential**: The verbose mode logs clearly showed the bug (`toFinishReason could not extract string, using JSON`)
3. **Provider variability**: Different providers may return data in different formats

## Prevention

1. Add comprehensive tests for finish reason parsing with all known providers
2. Log warnings when falling back to JSON.stringify (currently only at debug level)
3. Consider schema validation for provider responses
