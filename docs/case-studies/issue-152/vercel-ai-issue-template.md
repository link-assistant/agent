# Issue Template for Vercel AI SDK

## Title
`AI_RetryError` crashes with "Cannot read properties of undefined (reading 'input_tokens')" when provider returns missing usage data

## Description

### Bug Description
When using `streamText` with providers that return incomplete or missing usage data, the SDK crashes during retry logic with a `TypeError` before the error can be properly handled.

The error occurs in `_retryWithExponentialBackoff` at `ai/dist/index.mjs:1940` when attempting to access `input_tokens` from an undefined `usage` object.

### Environment
- **AI SDK Version**: v5.x / v6.x beta
- **Node Version**: v20.x
- **Runtime**: Bun 1.x
- **Provider**: @ai-sdk/openai-compatible (configured for Moonshot Kimi API)

### Reproduction Steps

1. Configure an OpenAI-compatible provider that may return incomplete usage data:
```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const provider = createOpenAICompatible({
  baseURL: 'https://api.moonshot.ai/v1',
  name: 'moonshot',
  apiKey: process.env.MOONSHOT_API_KEY,
});
```

2. Call `streamText` with `maxRetries > 0`:
```typescript
import { streamText } from 'ai';

const result = await streamText({
  model: provider('kimi-k2.5-free'),
  prompt: 'Hello',
  maxRetries: 3, // With retries enabled
});

for await (const event of result.fullStream) {
  // Process events
}
```

3. When the API returns a response without proper `usage` object, the SDK crashes.

### Error Output
```
AI_RetryError: Failed after 3 attempts. Last error: Cannot read properties of undefined (reading 'input_tokens')
    at _retryWithExponentialBackoff (/path/to/node_modules/ai/dist/index.mjs:1940:17)
    at processTicksAndRejections (native:7:39)
```

### Expected Behavior
The SDK should gracefully handle missing or undefined `usage` data by:
1. Using default values (0) for missing token counts
2. Not crashing during retry logic
3. Allowing the developer to handle the response appropriately

### Actual Behavior
The SDK crashes with an unhandled `TypeError` when attempting to access `usage.input_tokens` from an undefined `usage` object.

### Root Cause Analysis
The crash occurs because:
1. Some providers (especially OpenAI-compatible ones) don't always include usage data in their responses
2. The retry logic accesses `usage.input_tokens` without null checking
3. The error happens inside the retry mechanism, making it difficult to catch externally

### Suggested Fix

Add null checks before accessing usage properties in the retry logic:

```typescript
// In _retryWithExponentialBackoff or equivalent
const inputTokens = response?.usage?.input_tokens ?? 0;
const outputTokens = response?.usage?.output_tokens ?? 0;
```

Or use optional chaining:
```typescript
const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };
```

### Workaround
Setting `maxRetries: 0` prevents the crash but disables automatic retry functionality:
```typescript
const result = await streamText({
  model: provider('model'),
  prompt: 'Hello',
  maxRetries: 0, // Workaround: disable retries
});
```

### Related Issues
- #11217 - Usage undefined in SDK v6
- #9921 - Token Usage Normalization Proposal
- #4929 - Unable to retrieve token usage with DeepSeek API

### Additional Context
This issue affects any custom or OpenAI-compatible provider that may return incomplete responses. It's particularly problematic with:
- Moonshot Kimi API
- Local LLM servers (LM Studio, Ollama)
- Any provider that doesn't fully implement the OpenAI response spec

### Checklist
- [x] I have searched for similar issues
- [x] I have provided a minimal reproduction
- [x] I have included error output and stack traces
- [x] I have identified a potential fix

---

*This issue template was generated as part of case study analysis.*
*See: https://github.com/link-assistant/agent/issues/152*
