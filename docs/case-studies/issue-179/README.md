# Case Study: Issue #179 - Model Confusion in CLI Output

## Issue Summary

When running `agent --model big-pickle`, the logs show `kimi-k2.5-free` being mentioned, which creates confusion for users who explicitly specified a different model.

**Issue URL**: https://github.com/link-assistant/agent/issues/179

## Problem Statement

### Problem 1: Confusing Model Mentions in Logs

When a user specifies `--model big-pickle`, the logs show:

```json
{
  "type": "log",
  "level": "info",
  "timestamp": "2026-02-15T08:31:43.769Z",
  "service": "provider",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "getModel"
}
```

This is confusing because the user expects only `big-pickle` to be used.

### Problem 2: Missing Model Information in Output

The user wants to see which model actually generated each response in the output parts:

```json
{
  "type": "text",
  "timestamp": 1771144308510,
  "sessionID": "ses_39f92abdcffemBFOqUctsANi1x",
  "part": {
    "id": "prt_c606d66fb001UVz0YlSVSXj1oO",
    "type": "text",
    "text": "Hi! How can I help you today?"
  }
}
```

The user wants a `model` object added to show which model was used.

## Root Cause Analysis

### Why Does `kimi-k2.5-free` Appear?

The issue is in `js/src/provider/provider.ts` in the `getSmallModel` function (lines 1300-1345):

```typescript
export async function getSmallModel(providerID: string) {
  // ... config checks ...

  if (providerID === 'opencode' || providerID === 'local') {
    priority = [
      'kimi-k2.5-free',      // <-- This is first priority!
      'minimax-m2.1-free',
      'gpt-5-nano',
      'glm-4.7-free',
      'big-pickle',
    ];
  }
  // ...
}
```

This `getSmallModel` function is called in two places:

1. **Title Generation** (`js/src/session/prompt.ts:1561`): When generating a session title, the system uses a "small model" (usually faster/cheaper) to create the title.

2. **Session Summary** (`js/src/session/summary.ts:84`): When summarizing a session, a small model is used.

When the user specifies `--model big-pickle` from the `opencode` provider, the title generation still calls `getSmallModel('opencode')` which returns `kimi-k2.5-free` (the first priority in the list for opencode provider).

This is **by design** - it's meant to use cheaper/faster models for auxiliary tasks like title generation. However, the log message creates confusion by mentioning a different model.

### Why Model Information Is Missing

The current implementation doesn't include model information in the output parts because:

1. The AI SDK's `streamText` response does include model information via `result.response.modelId`
2. However, this information is not currently extracted and included in the event outputs

## Proposed Solutions

### Solution 1: Suppress Small Model Logs When Not Primary

Add a flag to `getModel` calls to indicate whether they're for auxiliary operations (title gen, summarization) vs primary operations. Reduce log level for auxiliary operations.

**Pros**: Reduces user confusion, logs stay accurate
**Cons**: Adds complexity, hides potentially useful debug info

### Solution 2: Add Context to Log Messages

Update log messages to clearly indicate the purpose:

```json
{
  "message": "getModel (title generation)",
  "modelID": "kimi-k2.5-free"
}
```

**Pros**: Transparent about what's happening
**Cons**: Doesn't reduce log noise

### Solution 3: Implement `--output-used-model` Flag

Add an optional flag that includes model information in each output part:

```json
{
  "type": "text",
  "part": {
    "text": "Hi! How can I help you today?",
    "model": {
      "providerID": "opencode",
      "modelID": "big-pickle",
      "responseModelId": "gpt-4o-mini-2024-07-18"
    }
  }
}
```

**Pros**: User gets clear info about which model answered
**Cons**: Increases output size (hence the opt-in flag)

### Solution 4: Add Model Info to Step Parts

Include model information in `step-start` and `step-finish` parts:

```json
{
  "type": "step_finish",
  "part": {
    "type": "step-finish",
    "model": {
      "providerID": "opencode",
      "modelID": "big-pickle",
      "responseModelId": "actual-model-id-from-api"
    },
    "tokens": {...}
  }
}
```

**Pros**: Natural place for model info (step-finish already has token info)
**Cons**: May not cover all use cases user wants

## Recommended Implementation

Based on analysis, recommend implementing:

1. **Add `--output-used-model` flag** - To include model information in output when requested
2. **Add model info to `step-finish` parts** - Include model info alongside tokens for each step
3. **Add context to auxiliary model log messages** - To clarify why other models appear

## Technical Implementation Details

### AI SDK Model Information

From the Vercel AI SDK documentation:

```typescript
const result = await streamText({
  model: openai('gpt-4'),
  prompt: 'Your prompt here',
});

const modelId = result.response.modelId;
// Can also access via steps: result.steps[i].response.modelId
```

The `response.modelId` field contains "the model that was used to generate the response. The AI SDK uses the response model from the provider response when available."

### Files to Modify

1. `js/src/flag/flag.ts` - Add `OUTPUT_USED_MODEL` flag
2. `js/src/cli/bootstrap.ts` - Add `--output-used-model` CLI option
3. `js/src/session/message-v2.ts` - Add model field to `StepFinishPart`
4. `js/src/session/processor.ts` - Extract and store model info from response
5. `js/src/cli/continuous-mode.js` - Include model info when outputting parts
6. `js/src/session/prompt.ts` - Add context to auxiliary model usage logs

## References

- [Vercel AI SDK streamText documentation](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK Provider Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- GitHub Issue: https://github.com/link-assistant/agent/issues/179
