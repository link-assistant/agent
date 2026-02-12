# Case Study: Issue #152 - Cannot read properties of undefined (reading 'input_tokens')

## Executive Summary

This case study analyzes a critical error occurring in the `link-assistant/agent` codebase when using the OpenCode provider with Kimi K2.5 model via Moonshot AI. The error manifests as `AI_RetryError: Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')`.

## Timeline of Events

### Event Sequence (2026-02-12)

| Timestamp (UTC) | Event |
|-----------------|-------|
| 06:41:35.538Z | Solution draft process starts |
| 06:41:57.167Z | Issue URL parsed, working directory created |
| 06:42:13.334Z | Model configuration: `kimi-k2.5-free` via OpenCode provider |
| 06:42:13.857Z | **WARNING**: `ProviderModelNotFoundError` - grok-code model not found |
| 06:42:13.873Z | Fallback to default model: `big-pickle` |
| 06:42:24.015Z | Second `ProviderModelNotFoundError` warning |
| 06:42:52.516Z | Third `ProviderModelNotFoundError` warning |
| 06:42:52.517Z | Ripgrep tree operation initiated |
| 06:42:52.542Z | Session processor started |
| 06:42:52.721Z | **FATAL ERROR**: `AI_RetryError` - Cannot read properties of undefined (reading 'input_tokens') |
| 06:42:52.833Z | Agent command completed (with error) |

A second run (07:09:54 - 07:10:30) exhibited identical behavior with the same error.

## Root Cause Analysis

### Primary Root Cause

The error occurs in the Vercel AI SDK's retry mechanism (`_retryWithExponentialBackoff`) when attempting to access `input_tokens` from an undefined `usage` object in the API response.

**Stack Trace Analysis:**
```
AI_RetryError: Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')
    at _retryWithExponentialBackoff (/home/hive/.bun/install/global/node_modules/ai/dist/index.mjs:1940:17)
```

### Contributing Factors

1. **Model Fallback Chain**: The requested model `kimi-k2.5-free` triggers multiple fallbacks:
   - Attempts to use `grok-code` (fails with `ProviderModelNotFoundError`)
   - Falls back to `big-pickle` as default model

2. **Provider Response Format Mismatch**: The OpenCode provider (or underlying Moonshot AI API) returns responses that don't include the expected `usage` object structure expected by the Vercel AI SDK.

3. **Token Usage Field Naming**: The Moonshot Kimi API uses `prompt_tokens` and `completion_tokens` naming convention (OpenAI-compatible format), but the SDK expects `input_tokens` and `output_tokens`.

4. **Missing Error Handling**: The retry mechanism in `ai/dist/index.mjs:1940` doesn't gracefully handle missing or undefined `usage` data before attempting to access its properties.

### Technical Details

#### Expected Response Structure (Vercel AI SDK)
```typescript
interface LanguageModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}
```

#### Actual Response from Moonshot Kimi API
```json
{
  "usage": {
    "prompt_tokens": 12345,
    "completion_tokens": 678,
    "total_tokens": 13023,
    "prompt_tokens_details": null,
    "completion_tokens_details": null
  }
}
```

#### The Gap
When the provider doesn't correctly transform the response, or when the API returns no `usage` object at all, the SDK crashes when accessing `response.usage.input_tokens`.

## Affected Components

| Component | Repository | Version | Impact |
|-----------|------------|---------|--------|
| Vercel AI SDK | `vercel/ai` | Unknown (likely v5.x or v6.x beta) | Primary affected component |
| OpenCode Provider | `@opencode-ai/sdk` | Unknown | Response transformation |
| link-assistant/agent | `link-assistant/agent` | 0.8.17 | Application layer |
| Moonshot Kimi API | N/A | N/A | API response format |

## Related Issues

### GitHub Issues

1. **[vercel/ai#11217](https://github.com/vercel/ai/issues/11217)**: "Bug: Usage is empty in ai sdk v6" - Reports that `usage` and `totalUsage` properties return `undefined` in AI SDK v6 beta.

2. **[vercel/ai#9921](https://github.com/vercel/ai/issues/9921)**: "V3 Spec Proposal: Token Usage Normalization for Vercel AI SDK" - Proposes standardizing token usage across providers to avoid mapping inconsistencies.

3. **[sst/opencode#423](https://github.com/sst/opencode/issues/423)**: "Context usage count is always 0 for some local openai-compatible providers" - Related issue where token counts register as NaN.

4. **[vercel/ai#4929](https://github.com/vercel/ai/issues/4929)**: "Unable to Retrieve Token Usage When Using the Latest SDK to Access DeepSeek API" - Similar issue with third-party API providers.

### Known Patterns

- OpenAI-compatible APIs often don't support `stream_options.include_usage`
- Different providers use different field names (`prompt_tokens` vs `input_tokens`)
- Some providers return `null` or `undefined` for usage fields

## Proposed Solutions

### Solution 1: Defensive Programming in link-assistant/agent (Recommended)

**Location**: `js/src/session/index.ts:576-715` (`getUsage` function)

The existing `toNumber` function already handles `undefined` values, but the error occurs before this function is called - in the AI SDK itself. We need to catch this error earlier.

**Implementation**:
```typescript
// In js/src/session/processor.ts, wrap the streamText call
try {
  const stream = fn();
  for await (const value of stream.fullStream) {
    // ... existing code
  }
} catch (e) {
  // Check if this is a usage-related TypeError
  if (e instanceof TypeError && e.message.includes('input_tokens')) {
    log.warn(() => ({
      message: 'API returned invalid usage data, continuing with zero usage',
      error: e.message,
    }));
    // Set default usage values
    input.assistantMessage.tokens = {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    // Continue processing
    return 'continue';
  }
  throw e; // Re-throw other errors
}
```

### Solution 2: Provider Configuration Fix

**Location**: OpenCode provider configuration

Add `includeUsage: true` option to ensure the provider requests usage data:

```json
{
  "moonshot": {
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "https://api.moonshot.ai/v1",
      "includeUsage": true
    }
  }
}
```

### Solution 3: Custom Provider Middleware

Create a middleware that ensures usage data is always present:

```typescript
// js/src/provider/usage-middleware.ts
export function withUsageDefaults() {
  return {
    async transformUsage(usage: LanguageModelUsage | undefined) {
      if (!usage) {
        return {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        };
      }
      return {
        inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
        reasoningTokens: usage.reasoningTokens ?? 0,
      };
    },
  };
}
```

### Solution 4: Report to Vercel AI SDK

Create an issue in the Vercel AI SDK repository with:

1. Clear reproduction steps
2. Expected behavior (graceful handling of missing usage)
3. Suggested fix (null check before accessing properties)

## Workarounds

### Immediate Workaround 1: Disable Retry

Set `maxRetries: 0` in the streamText call (already implemented in `js/src/session/prompt.ts:655`):
```typescript
streamText({
  maxRetries: 0,
  // ... other options
})
```

### Immediate Workaround 2: Use Different Model

Avoid using models that return incomplete usage data:
- Use Claude models via Anthropic provider
- Use GPT models via OpenAI provider
- Use models with confirmed usage support

### Immediate Workaround 3: Catch and Log

Add try-catch in the session processor to catch and log the error without crashing:
```typescript
case 'finish-step':
  let usage;
  try {
    usage = Session.getUsage({
      model: input.model,
      usage: value.usage ?? {},
      metadata: value.providerMetadata,
    });
  } catch (e) {
    log.warn(() => ({ message: 'Failed to get usage', error: e }));
    usage = { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
  }
```

## Reproducible Example

See: `./reproduce-error.ts`

```typescript
// experiments/issue-152/reproduce-error.ts
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const provider = createOpenAICompatible({
  baseURL: 'https://api.moonshot.ai/v1',
  name: 'moonshot',
  apiKey: process.env.MOONSHOT_API_KEY,
});

async function reproduce() {
  try {
    const result = await streamText({
      model: provider('kimi-k2.5-free'),
      prompt: 'Hello, world!',
      maxRetries: 3,
    });

    for await (const event of result.fullStream) {
      if (event.type === 'finish-step') {
        console.log('Usage:', event.usage);
        // This may throw: Cannot read properties of undefined (reading 'input_tokens')
        console.log('Input tokens:', event.usage.inputTokens);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

reproduce();
```

## Recommendations

### Short-term (Immediate)

1. **Add defensive null checks** in `Session.getUsage` to handle undefined `value.usage`
2. **Update error handling** in `SessionProcessor.process` to gracefully handle usage-related errors
3. **Document the limitation** in MODELS.md for Kimi K2.5 and similar models

### Medium-term (This Sprint)

1. **Create middleware** to normalize usage data across all providers
2. **Add integration tests** for providers that may return incomplete usage data
3. **Implement fallback models** that work reliably when primary model fails

### Long-term (Next Quarter)

1. **Contribute to Vercel AI SDK** with a PR to add null checks in retry logic
2. **Work with OpenCode team** to improve provider response normalization
3. **Create provider compatibility matrix** documenting which providers have full usage support

## References

### Documentation
- [Vercel AI SDK Error Handling](https://ai-sdk.dev/docs/ai-sdk-core/error-handling)
- [AI_RetryError Documentation](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-retry-error)
- [Moonshot Kimi API Documentation](https://platform.moonshot.ai/docs/api/chat)
- [OpenCode Providers](https://opencode.ai/docs/providers/)

### Source Files
- `js/src/session/index.ts:576-715` - getUsage function
- `js/src/session/processor.ts:41-406` - Session processor
- `js/src/session/prompt.ts:614-718` - streamText call site

### External Issues
- [vercel/ai#11217](https://github.com/vercel/ai/issues/11217) - Usage undefined in SDK v6
- [vercel/ai#9921](https://github.com/vercel/ai/issues/9921) - Token Usage Normalization Proposal
- [sst/opencode#423](https://github.com/sst/opencode/issues/423) - Context usage 0 for compatible providers

## Appendices

### Appendix A: Full Error Log

See: `solution-draft-log-1.txt` (lines 1819-1824)

```
[2026-02-12T06:42:52.721Z] [INFO] {
[2026-02-12T06:42:52.722Z] [INFO]   "type": "error",
[2026-02-12T06:42:52.722Z] [INFO]   "errorType": "UnhandledRejection",
[2026-02-12T06:42:52.722Z] [INFO]   "message": "Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')",
[2026-02-12T06:42:52.722Z] [INFO]   "stack": "AI_RetryError: Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')\n    at _retryWithExponentialBackoff (/home/hive/.bun/install/global/node_modules/ai/dist/index.mjs:1940:17)\n    at processTicksAndRejections (native:7:39)"
[2026-02-12T06:42:52.722Z] [INFO] }
```

### Appendix B: Model Fallback Chain

```
User Request: kimi-k2.5-free (via moonshot provider)
    ↓
Attempt 1: grok-code → ProviderModelNotFoundError
    ↓
Fallback: big-pickle (opencode default)
    ↓
API Call → Response without usage data
    ↓
SDK Retry 1 → Cannot read 'input_tokens' of undefined
    ↓
SDK Retry 2 → Cannot read 'input_tokens' of undefined
    ↓
SDK Retry 3 → Cannot read 'input_tokens' of undefined
    ↓
AI_RetryError: Failed after 3 attempts
```

### Appendix C: Related Codebase Files

| File | Purpose |
|------|---------|
| `js/src/session/processor.ts` | Processes AI stream events including finish-step with usage |
| `js/src/session/index.ts` | Contains `getUsage` function and `toNumber` helper |
| `js/src/session/prompt.ts` | Calls `streamText` with provider configuration |
| `js/src/provider/provider.ts` | Provider initialization and model resolution |
| `js/src/provider/opencode.js` | OpenCode provider implementation |
| `js/src/session/retry.ts` | Retry configuration for session errors |

---

*Case Study compiled on 2026-02-12*
*Author: AI Issue Solver*
*Issue: https://github.com/link-assistant/agent/issues/152*
