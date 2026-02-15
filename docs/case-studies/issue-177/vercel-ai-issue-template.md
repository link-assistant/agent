# Issue Template for Vercel AI SDK

**Repository:** vercel/ai
**Title:** `@ai-sdk/openai-compatible`: Upgrade to specificationVersion v3 for AI SDK 6.x compatibility

---

## Description

When using AI SDK 6.x with `@ai-sdk/openai-compatible` provider, the following warning is logged on every model instantiation:

```
AI SDK Warning System: To turn off warning logging, set the AI_SDK_LOG_WARNINGS global to false.
AI SDK Warning (opencode.chat / kimi-k2.5-free): The feature "specificationVersion" is used in a compatibility mode. Using v2 specification compatibility mode. Some features may not be available.
```

This warning appears because `@ai-sdk/openai-compatible` still implements `specificationVersion: 'v2'` while AI SDK 6.x expects `specificationVersion: 'v3'`.

## Reproduction

1. Install `ai@^6.0.1` and `@ai-sdk/openai-compatible@latest`
2. Create a model using the OpenAI-compatible provider
3. Call `streamText()` or `generateText()`
4. Observe the warning logged to console

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';

const provider = createOpenAICompatible({
  name: 'my-provider',
  baseURL: 'https://api.example.com/v1',
  apiKey: 'test',
});

const model = provider.languageModel('some-model');

// This triggers the warning
const result = await streamText({
  model,
  prompt: 'Hello',
});
```

**Expected behavior:** No warning should appear since the package should be compatible with AI SDK 6.x

**Actual behavior:** Warning appears twice per session (once per `streamText` call in the agent loop)

## Environment

- AI SDK version: 6.0.1
- @ai-sdk/openai-compatible version: latest
- Node.js version: Bun 1.2.20
- Platform: macOS

## Impact

This warning causes noise in CLI applications that use the OpenAI-compatible provider, making it harder to spot actual issues. While the functionality works via compatibility mode, the warning suggests the package may need updates.

## Suggested Fix

Update `@ai-sdk/openai-compatible` to implement `specificationVersion: 'v3'` following the patterns in the [migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) and [custom providers documentation](https://ai-sdk.dev/providers/community-providers/custom-providers).

## Workaround

Users can suppress the warning by setting:

```typescript
globalThis.AI_SDK_LOG_WARNINGS = false;
```

However, this also suppresses legitimate warnings.

## Related

- [vercel/ai#10689](https://github.com/vercel/ai/issues/10689) - Warn when using v2 models with AI SDK 6
- [vercel/ai#10770](https://github.com/vercel/ai/pull/10770) - PR that added the warning
- [Migration Guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)
