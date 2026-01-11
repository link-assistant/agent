# Case Study: Issue #119 - DecimalError Invalid Argument in getUsage()

## Summary

The `Session.getUsage()` function crashes with a `[DecimalError] Invalid argument: [object Object]` error when token usage data from certain AI providers (e.g., `opencode/grok-code`) contains unexpected values like objects, `NaN`, or `Infinity` instead of numeric values. The `decimal.js` library throws this error when passed non-numeric values.

## Timeline of Events

### Discovery and Analysis

| Date | Event |
|------|-------|
| Dec 25, 2025 | Upstream sst/opencode#6161 reported similar DecimalError issue in v0.3.58 |
| Jan 11, 2026 | Issue #119 reported in link-assistant/agent with `opencode/grok-code` model |
| Jan 11, 2026 | Root cause identified: missing `safe()` wrapper function from upstream OpenCode |

### Error Manifestation

The error appears during `step_finish` events in `processor.ts:222-226` when calculating token costs:

```typescript
case 'finish-step':
  const usage = Session.getUsage({
    model: input.model,
    usage: value.usage,        // <-- May contain objects or non-finite numbers
    metadata: value.providerMetadata,
  });
```

## Root Cause Analysis

### Primary Root Cause: Missing safe() wrapper function

The upstream OpenCode repository has a `safe()` wrapper function that sanitizes numeric inputs before passing them to `Decimal.js`:

**Upstream OpenCode (current implementation):**
```typescript
const safe = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return value
}

const tokens = {
  input: safe(adjustedInputTokens),
  output: safe(input.usage.outputTokens ?? 0),
  reasoning: safe(input.usage?.reasoningTokens ?? 0),
  cache: {
    write: safe(/* cache write tokens */),
    read: safe(cachedInputTokens),
  },
};

return {
  cost: safe(new Decimal(0).add(...).toNumber()),
  tokens,
};
```

**Current agent implementation (vulnerable):**
```typescript
// No safe() wrapper - values passed directly to Decimal
const tokens = {
  input: adjustedInputTokens,  // Could be NaN, Infinity, or object
  output: input.usage.outputTokens ?? 0,
  ...
};

return {
  cost: new Decimal(0).add(new Decimal(tokens.input)...).toNumber(),  // CRASH!
  tokens,
};
```

### Why Objects Appear in Token Data

Some AI providers return usage data with unexpected structures:

1. **Malformed API responses**: Some providers return objects like `{ count: 100 }` instead of raw numbers
2. **NaN from arithmetic**: Operations like `0/0` or `undefined - number` produce NaN
3. **Infinity**: Very large token counts or division edge cases
4. **Null coalescing gaps**: The `??` operator doesn't catch `NaN` or `Infinity` (only `null`/`undefined`)

### Error Chain Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI Provider Returns Usage Data                    │
│         (May contain objects, NaN, or Infinity in token fields)     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   processor.ts 'finish-step' event                   │
│             calls Session.getUsage() with raw usage data            │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              getUsage() builds tokens object                         │
│     adjustedInputTokens = (usage.inputTokens ?? 0) - cached         │
│     (NaN if inputTokens is NaN, Infinity, or object)                │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│            Decimal.js constructor receives non-numeric value         │
│              new Decimal([object Object]) throws error              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│      [DecimalError] Invalid argument: [object Object]               │
│              Uncaught exception crashes the session                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Impact

1. **Session crashes**: Users lose their conversation context when the error occurs
2. **Model output truncation**: Error may appear mid-response, cutting off content
3. **Provider incompatibility**: Certain models (e.g., `opencode/grok-code`) become unusable
4. **No graceful degradation**: Cost tracking failure should not crash the entire session

## Solutions

### Implemented Fix 1: Add safe() wrapper function

Add the `safe()` helper function to sanitize all numeric inputs:

```typescript
const safe = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return value;
};
```

Apply it to all token values and the final cost calculation result.

### Implemented Fix 2: Try-catch wrapper for cost calculation

Add defensive error handling around the Decimal calculations:

```typescript
try {
  // Decimal calculations
  cost = new Decimal(0).add(...).toNumber();
} catch (error) {
  log.warn('Failed to calculate cost', { error, tokens });
  cost = 0;
}
```

This ensures that even if an unexpected value slips through `safe()`, the session won't crash.

## Verification

### Unit Tests Added

1. `safe() returns 0 for NaN`
2. `safe() returns 0 for Infinity`
3. `safe() returns 0 for -Infinity`
4. `safe() returns original value for finite numbers`
5. `safe() handles edge case: 0`
6. `getUsage() handles NaN in inputTokens`
7. `getUsage() handles object-like values gracefully`
8. `getUsage() handles Infinity in outputTokens`
9. `getUsage() calculates correctly with valid data`

### Experiment Script

An experiment script (`experiments/issue-119-decimal-error/`) demonstrates the error reproduction and fix verification.

## Related Issues

- **Upstream**: [sst/opencode#6161](https://github.com/sst/opencode/issues/6161) - Similar DecimalError bug, resolved in newer versions
- **Cross-reference**: [link-assistant/hive-mind#1112](https://github.com/link-assistant/hive-mind/issues/1112) - Related report

## Files Affected

| File | Issue | Fix Required |
|------|-------|--------------|
| `js/src/session/index.ts` | Missing safe() wrapper for token values | Add safe() function and apply to all numeric inputs |
| `js/tests/session-usage.test.ts` | No unit tests for getUsage edge cases | Add comprehensive unit tests |

## Lessons Learned

1. **Validate external data**: AI provider responses should be treated as untrusted input
2. **Use defensive wrappers**: The `safe()` pattern prevents cascading failures from bad data
3. **Don't let secondary features crash primary flow**: Cost calculation failure should not terminate sessions
4. **Keep forks updated**: The upstream fix existed; maintaining sync prevents such regressions
5. **Test edge cases**: Unit tests for NaN, Infinity, and object inputs would have caught this earlier

## References

- [GitHub Issue #119](https://github.com/link-assistant/agent/issues/119)
- [Upstream sst/opencode#6161](https://github.com/sst/opencode/issues/6161)
- [Upstream fix in session/index.ts](https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/index.ts)
- [decimal.js documentation](https://mikemcl.github.io/decimal.js/)
- [Number.isFinite() MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isFinite)
