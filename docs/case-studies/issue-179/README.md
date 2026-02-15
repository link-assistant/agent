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

## Implemented Solutions

### Solution 1: Disable Auxiliary Tasks by Default (Token Savings)

By making `--generate-title` and `--summarize-session` opt-in instead of opt-out:

- **`--generate-title`**: Already disabled by default (from issue #157)
- **`--summarize-session`**: Now disabled by default

When these are disabled, `getSmallModel` is not called, so no confusing model mentions appear.

**Benefits**:
- Saves tokens on every request
- Eliminates confusing log messages about auxiliary models
- Users can explicitly enable these features when needed

### Solution 2: `--output-response-model` Flag

Added a new flag that includes model information in `step_finish` parts:

```json
{
  "type": "step_finish",
  "part": {
    "type": "step-finish",
    "model": {
      "providerID": "opencode",
      "requestedModelID": "big-pickle",
      "respondedModelID": "gpt-4o-mini-2024-07-18"
    },
    "tokens": {...}
  }
}
```

**Usage**:
- CLI flag: `agent --output-response-model`
- Environment variable: `AGENT_OUTPUT_RESPONSE_MODEL=true`

**Schema Changes**:
- `modelID` → `requestedModelID` (clearer: what you asked for)
- `responseModelId` → `respondedModelID` (clearer: what actually responded)

### Solution 3: Clearer Log Messages for Auxiliary Tasks

Updated `getSmallModel` to log with explicit context:

```json
{
  "message": "selected small model for auxiliary task",
  "modelID": "kimi-k2.5-free",
  "providerID": "opencode",
  "hint": "This model is used for title/summary generation, not primary requests"
}
```

## Files Modified

1. **`js/src/flag/flag.ts`**
   - Added `OUTPUT_RESPONSE_MODEL` flag
   - Added `SUMMARIZE_SESSION` flag
   - Added setter functions for both

2. **`js/src/index.js`**
   - Added `--output-response-model` CLI option
   - Added `--summarize-session` CLI option
   - Wired up middleware to set flags

3. **`js/src/session/message-v2.ts`**
   - Added `ModelInfo` schema with `providerID`, `requestedModelID`, `respondedModelID`
   - Added optional `model` field to `StepFinishPart`

4. **`js/src/session/processor.ts`**
   - Extract model info from finish-step response
   - Include model info in step_finish when flag is enabled

5. **`js/src/session/summary.ts`**
   - Added check for `SUMMARIZE_SESSION` flag
   - Skip AI-powered summarization when disabled

6. **`js/src/provider/provider.ts`**
   - Already had clear log messages (from initial implementation)

7. **`js/tests/output-response-model.test.js`** (renamed from output-used-model.test.js)
   - Tests for `--output-response-model` flag
   - Tests for `--summarize-session` behavior

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

### New CLI Options

```bash
# Include model info in step_finish events
agent --output-response-model

# Enable session summarization (disabled by default)
agent --summarize-session

# Enable title generation (disabled by default)
agent --generate-title

# Combine for full auxiliary task support
agent --generate-title --summarize-session --output-response-model
```

### Environment Variables

```bash
# Include model info in output
export AGENT_OUTPUT_RESPONSE_MODEL=true

# Enable session summarization
export AGENT_SUMMARIZE_SESSION=true

# Enable title generation
export AGENT_GENERATE_TITLE=true
```

## References

- [Vercel AI SDK streamText documentation](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK Provider Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- GitHub Issue: https://github.com/link-assistant/agent/issues/179
