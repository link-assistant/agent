# Case Study: Issue #61 - Error when using "google/gemini-3-pro"

## Issue Summary

**Reported by:** @andchir
**Issue URL:** https://github.com/link-assistant/agent/issues/61

### Error Description

When users try to use the Google Gemini model with the command:

```bash
echo "hi" | agent --model google/gemini-3-pro
```

They receive a `ProviderInitError`:

```json
{
  "type": "error",
  "errorType": "UnhandledRejection",
  "message": "ProviderInitError",
  "stack": "ProviderInitError: ProviderInitError\n    at <anonymous> (/root/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:745:17)\n    at processTicksAndRejections (native:7:39)"
}
```

## Timeline of Investigation

### 1. Initial Analysis

- The error occurs at `provider.ts:745`, which is the `InitError` being thrown in the `getSDK` function
- The underlying error is wrapped in `InitError` with the `providerID`

### 2. Reproduction Attempts

#### Without API Key

```bash
echo "hi" | agent --model google/gemini-3-pro
```

Result: `ProviderModelNotFoundError` - Provider "google" is not loaded because no API key is found.

#### With GEMINI_API_KEY

```bash
GEMINI_API_KEY=test-key echo "hi" | agent --model google/gemini-3-pro
```

Result: Same `ProviderModelNotFoundError` - Provider still not loaded!

### 3. Root Cause Identification

The root cause was found in `src/provider/provider.ts` lines 600-610:

```typescript
// load env
for (const [providerID, provider] of Object.entries(database)) {
  if (disabled.has(providerID)) continue;
  const apiKey = provider.env.map((item) => process.env[item]).at(0);
  if (!apiKey) continue;
  mergeProvider(
    providerID,
    // only include apiKey if there's only one potential option
    provider.env.length === 1 ? { apiKey } : {},
    'env'
  );
}
```

**The Bug:** When a provider has multiple possible environment variables (like Google with `GOOGLE_GENERATIVE_AI_API_KEY` and `GEMINI_API_KEY`), the code correctly finds the API key from whichever is set, but then **fails to pass it to `mergeProvider`** because `provider.env.length === 1` is `false`.

This means:

1. For Google provider: `provider.env = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"]`
2. If user sets `GEMINI_API_KEY`, the code finds it (`apiKey` is not null)
3. But `provider.env.length === 1` is `false`, so an empty object `{}` is passed
4. The @ai-sdk/google SDK only checks `GOOGLE_GENERATIVE_AI_API_KEY` by default
5. Since that's not set, the SDK fails during initialization

## Technical Details

### Provider Registration Flow

1. **Load env** (lines 600-610): Check if any env var is set, register provider
2. **Load apikeys** (lines 612-618): Check stored API keys from auth module
3. **Load custom** (lines 620-632): Run custom loaders for specific providers
4. **Load config** (lines 634-637): Apply config file options

### Affected Providers

Providers with multiple env variables that could be affected:

- `google`: `["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"]`
- Potentially others in the models.dev database

### The @ai-sdk/google Package

The Google AI SDK package (`@ai-sdk/google`) accepts an `apiKey` option in `createGoogleGenerativeAI()`. If not provided, it defaults to reading `GOOGLE_GENERATIVE_AI_API_KEY` from the environment.

**Documentation Reference:** https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai

## Solution

The fix involves always passing the found `apiKey` to `mergeProvider`, regardless of how many env variable options exist:

**Before (buggy):**

```typescript
// load env
for (const [providerID, provider] of Object.entries(database)) {
  if (disabled.has(providerID)) continue;
  const apiKey = provider.env.map((item) => process.env[item]).at(0);
  if (!apiKey) continue;
  mergeProvider(
    providerID,
    // only include apiKey if there's only one potential option
    provider.env.length === 1 ? { apiKey } : {}, // BUG: empty object for Google!
    'env'
  );
}
```

**After (fixed):**

```typescript
// load env
for (const [providerID, provider] of Object.entries(database)) {
  if (disabled.has(providerID)) continue;
  // Find the first truthy env var (supports multiple env var options like Google's
  // GOOGLE_GENERATIVE_AI_API_KEY and GEMINI_API_KEY)
  const apiKey = provider.env.map((item) => process.env[item]).find(Boolean);
  if (!apiKey) continue;
  // Always pass the API key - the provider SDK needs it for authentication
  mergeProvider(providerID, { apiKey }, 'env');
}
```

**Changes:**

1. Changed from `.at(0)` to `.find(Boolean)` to be more explicit about finding the first truthy value
2. Always pass `{ apiKey }` instead of conditionally passing an empty object
3. Added comments explaining the multi-env-var support

## References

- Issue: https://github.com/link-assistant/agent/issues/61
- @ai-sdk/google docs: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
- models.dev API: https://models.dev/api.json
- Original OpenCode provider.ts: https://github.com/sst/opencode

## Lessons Learned

1. When providers support multiple environment variables, always use the found value
2. The `provider.env.length === 1` check was likely intended as a safety measure but caused a regression
3. Environment variable fallback logic should be tested with all supported variables
