# Case Study: Issue #187 - Missing Response Metadata for kilo/glm-5-free Model

## Summary

When using the `kilo/glm-5-free` model via the agent CLI, the step-finish event shows incomplete response metadata:
- `"reason": "unknown"` instead of the actual finish reason
- `"cost": 0` with all token counts as `0`

## Reproduction

```bash
echo 'hi' | agent --model kilo/glm-5-free
```

## Timeline / Sequence of Events

1. **User sends message** via stdin to the agent CLI
2. **Agent creates session** and prepares the request
3. **Provider initialization**: Kilo provider loads using `@openrouter/ai-sdk-provider` with custom baseURL `https://api.kilo.ai/api/openrouter`
4. **API request sent** to Kilo Gateway with model `z-ai/glm-5:free`
5. **Streaming response received** - text content streams correctly
6. **finish-step event emitted** - but with missing metadata:
   - `finishReason: undefined` (converted to `"unknown"`)
   - `usage.inputTokens: undefined` (defaults to `0`)
   - `usage.outputTokens: undefined` (defaults to `0`)

## Root Cause Analysis

### The Data Flow

```
Kilo API Response → @openrouter/ai-sdk-provider → AI SDK → Agent getUsage()
```

### Key Finding: Data Location Mismatch

The verbose logs reveal the core issue:

```json
{
  "rawUsage": "{\"inputTokenDetails\":{},\"outputTokenDetails\":{}}",
  "rawMetadata": "{\"openrouter\":{\"usage\":{\"promptTokens\":12004,\"promptTokensDetails\":{\"cachedTokens\":10880},\"completionTokens\":40,\"completionTokensDetails\":{\"reasoningTokens\":20},\"cost\":0.0001714,\"totalTokens\":12044,...}}}"
}
```

**The problem**:
- The **standard `usage` object** (`rawUsage`) has empty/undefined token values
- The **actual usage data** is correctly populated in `rawMetadata.openrouter.usage`

### Technical Root Cause

The `@openrouter/ai-sdk-provider` SDK processes streaming responses in `OpenRouterChatLanguageModel`:

1. At initialization, `usage` object is set with `Number.NaN` values (lines 1923-1929):
   ```js
   const usage = {
     inputTokens: Number.NaN,
     outputTokens: Number.NaN,
     ...
   };
   ```

2. The SDK expects usage data in streaming chunks at `value.usage` (line 1971):
   ```js
   if (value.usage != null) {
     usage.inputTokens = value.usage.prompt_tokens;
     ...
   }
   ```

3. The SDK also populates `openrouterUsage` separately for provider metadata

4. On `flush()`, it emits both:
   ```js
   controller.enqueue({
     type: "finish",
     finishReason,
     usage,  // ← Standard usage (may be NaN if never populated)
     providerMetadata: {
       openrouter: { usage: openrouterUsage }  // ← Always populated
     }
   });
   ```

### Why Kilo Data Is Missing from Standard Usage

The Kilo Gateway API returns usage data in the final streaming chunk, but the format may differ:
- The SDK expects `value.usage.prompt_tokens` (snake_case)
- Kilo may send it differently, or the data arrives in a separate chunk after the SDK's transform has already flushed

The result: `openrouterUsage` gets populated (stored in `providerMetadata`), but the standard `usage` object retains `NaN` values which become `undefined` in the final output.

### finishReason Issue

Similarly, `finishReason` defaults to `"other"` and only gets updated when:
```js
if ((choice?.finish_reason) != null) {
  finishReason = mapOpenRouterFinishReason(choice.finish_reason);
}
```

If the Kilo API doesn't send `finish_reason` in the expected chunk, it remains unmapped, resulting in `"unknown"` after our `toFinishReason()` fallback.

## Evidence

### Verbose Log Excerpts

```json
// Usage data is in providerMetadata, not standard usage
{
  "rawUsage": "{\"inputTokenDetails\":{},\"outputTokenDetails\":{}}",
  "rawMetadata": "{\"openrouter\":{\"usage\":{\"promptTokens\":12004,...}}}"
}

// finishReason is undefined
{
  "valueType": "undefined",
  "value": "undefined",
  "message": "toFinishReason input"
}

// All token counts default to 0
{
  "context": "inputTokens",
  "valueType": "undefined",
  "message": "toNumber received undefined/null, returning 0"
}
```

### Final step_finish Output

```json
{
  "type": "step_finish",
  "part": {
    "reason": "unknown",
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": { "read": 0, "write": 0 }
    },
    "model": {
      "providerID": "kilo",
      "requestedModelID": "z-ai/glm-5:free",
      "respondedModelID": "z-ai/glm-5"
    }
  }
}
```

## Solutions

### Solution 1: Extract Data from providerMetadata (Recommended - Workaround)

Since the data IS available in `providerMetadata.openrouter.usage`, we can modify `Session.getUsage()` to fall back to this location when standard usage is empty/undefined.

**Pros**:
- Fixes the issue immediately without waiting for upstream fix
- Works with current SDK version
- No external dependencies

**Cons**:
- Workaround rather than root cause fix
- OpenRouter-specific code path

### Solution 2: Report Upstream Issue to @openrouter/ai-sdk-provider

The SDK should:
1. Better handle cases where usage arrives in non-standard streaming chunks
2. Or, copy data from `openrouterUsage` to standard `usage` before emitting finish event

**Pros**:
- Fixes root cause
- Benefits all users of the SDK

**Cons**:
- Requires waiting for upstream maintainers
- May take time to release

### Solution 3: Report Issue to Kilo Gateway

If the Kilo Gateway isn't sending usage data in the format expected by the OpenRouter SDK, they should align with the OpenRouter API specification.

**Pros**:
- Fixes at the source
- All downstream tools benefit

**Cons**:
- Requires Kilo team action
- May require API changes

## Recommended Implementation

Implement **Solution 1** as immediate fix, while also pursuing **Solutions 2 and 3** for long-term resolution.

### Code Changes Required

In `js/src/session/index.ts`, modify `getUsage()` to:

1. Check if standard usage has valid data
2. If not, fall back to `metadata.openrouter.usage`
3. Extract `finishReason` from metadata if not available in standard response

## Related Issues

- [OpenRouterTeam/ai-sdk-provider#22](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/22) - Similar issue with reasoning tokens
- [link-assistant/agent#125](https://github.com/link-assistant/agent/issues/125) - finishReason object handling
- [link-assistant/agent#127](https://github.com/link-assistant/agent/issues/127) - Nested token extraction
- [link-assistant/agent#152](https://github.com/link-assistant/agent/issues/152) - Incomplete usage data handling

## References

- [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter Usage Accounting](https://openrouter.ai/docs/guides/guides/usage-accounting)
- [@openrouter/ai-sdk-provider npm](https://www.npmjs.com/package/@openrouter/ai-sdk-provider)
- [AI SDK LanguageModelUsage type](https://github.com/vercel/ai/blob/main/packages/ai/src/types/usage.ts)
