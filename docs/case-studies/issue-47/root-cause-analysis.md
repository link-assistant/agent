# Issue #47: `--model anthropic/claude-sonnet-4-5` didn't work

## Timeline of Events

1. **User Action**: User runs `agent auth login`
   - Selects "Anthropic" as provider
   - Chooses "Claude Pro/Max" as login method
   - Completes OAuth flow successfully
   - OAuth credentials saved to auth.json with type='oauth'

2. **User Action**: User runs `echo "hi" | agent --model anthropic/claude-sonnet-4-5`
   - Command line argument parsed: providerID="anthropic", modelID="claude-sonnet-4-5"
   - Error occurs: `ProviderInitError` at `src/provider/provider.ts:732`

## Technical Analysis

### Command Line Parsing

Location: `src/index.js:89-92`

```javascript
const modelParts = argv.model.split('/');
let providerID = modelParts[0] || 'opencode'; // = 'anthropic'
let modelID = modelParts.slice(1).join('/') || 'grok-code'; // = 'claude-sonnet-4-5'
```

### Provider Initialization Flow

Location: `src/provider/provider.ts`

1. **Models Database**: Fetched from `https://models.dev/api.json`
   - Confirmed: `anthropic` provider exists
   - Confirmed: `claude-sonnet-4-5` model exists in anthropic.models
   - NPM package: `@ai-sdk/anthropic`

2. **Custom Loader** (lines 34-66):

   ```typescript
   async anthropic(input) {
     const auth = await Auth.get('anthropic');
     if (auth?.type === 'oauth') {
       const loaderFn = await AuthPlugins.getLoader('anthropic');
       if (loaderFn) {
         const result = await loaderFn(() => Auth.get('anthropic'), input);
         if (result.fetch) {
           return {
             autoload: true,  // <-- Should enable the provider
             options: {
               apiKey: result.apiKey || '',
               fetch: result.fetch,
               headers: { 'anthropic-beta': '...' }
             }
           };
         }
       }
     }
     // Default: no autoload
     return { autoload: false, options: { headers: {...} } };
   }
   ```

3. **Provider Loading** (lines 608-619):

   ```typescript
   for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
     const result = await fn(database[providerID]);
     if (result && (result.autoload || providers[providerID])) {
       mergeProvider(
         providerID,
         result.options ?? {},
         'custom',
         result.getModel
       );
     }
   }
   ```

4. **SDK Initialization** (lines 661-733):
   When `Provider.getModel('anthropic', 'claude-sonnet-4-5')` is called:
   - Line 750: Gets provider from state
   - Line 752: Gets model info
   - Line 754: Calls `getSDK(provider.info, info)`
   - Inside getSDK:
     - Line 684: Installs `@ai-sdk/anthropic` package
     - Line 700: Imports the module
     - Line 724: Finds export starting with 'create' (should be `createAnthropic`)
     - Line 725-728: Calls the function
     - Line 732: **Catches error and throws `ProviderInitError`**

### Root Cause: Empty API Key in OAuth Flow

**CONFIRMED ROOT CAUSE**: The error occurs because the `AnthropicPlugin.loader` in `src/auth/plugins.ts:279` returns an empty string for `apiKey`:

```typescript
return {
  apiKey: '',  // <-- INVALID: AI SDK requires non-empty API key
  async fetch(input: RequestInfo | URL, init?: RequestInit) { ... }
};
```

When the `@ai-sdk/anthropic` package's `createAnthropic` function is called with an empty API key, it fails validation and throws an error. This error is caught at line 732 and wrapped as `ProviderInitError`.

**Why this happens**:

1. User authenticates via OAuth, which uses Bearer tokens in the Authorization header
2. The custom `fetch` function handles authentication via the Bearer token
3. AI SDK still requires a non-empty `apiKey` parameter, even when using custom fetch
4. The empty string `''` fails SDK validation

### Comparison with Original OpenCode

In `original-opencode/packages/opencode/src/provider/provider.ts`:

- Lines 29-38: The `anthropic` custom loader is much simpler
- It returns `autoload: false` always
- It only adds headers, no custom fetch
- **Key difference**: OpenCode doesn't have OAuth support built into the anthropic loader

## Solution

Change the `apiKey` value from an empty string to a valid placeholder string for all OAuth loaders in `src/auth/plugins.ts`:

**Three OAuth loaders affected:**

1. **Anthropic (line 279)** - For Claude Pro/Max authentication
2. **GitHub Copilot (line 554)** - For GitHub Copilot authentication
3. **OpenAI (line 779)** - For ChatGPT authentication

```typescript
// Before (broken):
return {
  apiKey: '',  // Fails AI SDK validation
  async fetch(...) { ... }
};

// After (fixed):
return {
  apiKey: 'oauth-token-used-via-custom-fetch',  // Valid placeholder
  async fetch(...) { ... }
};
```

This placeholder value satisfies the AI SDK's validation requirements while the actual authentication is handled by the custom `fetch` function using the Bearer/OAuth token from OAuth credentials.

**Why this works:**

- AI SDK providers require a non-empty `apiKey` parameter
- The actual API key is never used when custom `fetch` is provided
- OAuth authentication happens via Bearer token in the custom fetch's Authorization header
- The placeholder string clearly documents that OAuth is being used

## Files Analyzed

- `src/index.js` - Command line parsing
- `src/provider/provider.ts` - Provider initialization logic
- `src/provider/models.ts` - Models database loading
- `src/auth/plugins.ts` - OAuth plugin implementation
- `src/cli/cmd/auth.ts` - Auth command implementation
- `original-opencode/packages/opencode/src/provider/provider.ts` - Reference implementation

## External Resources

- [Models.dev API](https://models.dev/api.json) - Provider and model database
- [Claude Sonnet 4.5 Documentation](https://www.anthropic.com/claude/sonnet)
- [AI SDK Anthropic Provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
