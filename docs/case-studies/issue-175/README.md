# Case Study: Issue #175 - `echo 'hi' | agent --model kimi-k2.5-free` Not Working on macOS

## Summary

When running `echo 'hi' | agent --model kimi-k2.5-free` on macOS, the agent throws a `ProviderModelNotFoundError` indicating that the model cannot be found, even though:
1. The `kimi-k2.5-free` model exists in the models.dev API
2. The OpenCode provider is correctly found
3. The model has `cost.input === 0` (free tier)

## Timeline of Events

### 2026-02-14T20:28:55.205Z - Agent Started
User installs and runs:
```bash
bun install -g @link-assistant/agent    # version 0.13.1
echo 'hi' | agent --model kimi-k2.5-free
```

### 2026-02-14T20:28:55.206Z - Instance Creation
```json
{"service":"default","directory":"/Users/konard","message":"creating instance"}
{"service":"project","directory":"/Users/konard","message":"fromDirectory"}
```

### 2026-02-14T20:28:55.214Z - Provider State Initialization
```json
{"service":"provider","status":"started","message":"state"}
```

### 2026-02-14T20:28:55.215Z - Config Loading
Multiple config files are checked:
- `/Users/konard/.config/link-assistant-agent/config.json`
- `/Users/konard/.config/link-assistant-agent/opencode.json`
- `/Users/konard/.config/link-assistant-agent/opencode.jsonc`

### 2026-02-14T20:28:55.218Z - Models.dev Refresh (Non-blocking)
```json
{"service":"models.dev","file":{},"message":"refreshing"}
```
**Note**: The `refresh()` call is not awaited, leading to potential race conditions with stale cache.

### 2026-02-14T20:28:55.224Z - Providers Found
Both OpenCode and Kilo providers are discovered:
```json
{"service":"provider","providerID":"opencode","message":"found"}
{"service":"provider","providerID":"kilo","message":"found"}
```

### 2026-02-14T20:28:55.224Z - Model Resolution Failed
The short model name resolution failed:
```json
{
  "level": "warn",
  "service": "provider",
  "modelID": "kimi-k2.5-free",
  "message": "unable to resolve short model name, using opencode as default"
}
```

This fallback behavior then led to:
```json
{
  "input": "kimi-k2.5-free",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "resolved short model name"
}
```

### 2026-02-14T20:28:55.246Z - Error Thrown
```json
{
  "level": "error",
  "service": "session.prompt",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "error": "ProviderModelNotFoundError",
  "message": "Failed to initialize specified model - NOT falling back to default (explicit provider specified)"
}
```

## Root Cause Analysis

### Primary Root Cause: Race Condition in Model Database Loading

The `ModelsDev.get()` function has a race condition:

```typescript
// js/src/provider/models.ts:70-77
export async function get() {
  refresh();  // NOT AWAITED - async refresh runs in background
  const file = Bun.file(filepath);
  const result = await file.json().catch(() => {});
  if (result) return result as Record<string, Provider>;
  const json = await data();
  return JSON.parse(json) as Record<string, Provider>;
}
```

The `refresh()` function fetches the latest models from `https://models.dev/api.json` but is **not awaited**. This means:
1. If the cache file doesn't exist or is stale, old/missing data is used
2. The fresh data arrives after the model lookup has already failed
3. Users with new installations or outdated caches will encounter this error

### Secondary Issue: No Fallback for New Installations

When a user runs the agent for the first time:
1. The cache file at `~/.cache/link-assistant-agent/models.json` doesn't exist
2. The `data()` function is called which fetches from models.dev synchronously
3. However, if this fetch fails or is slow, the model lookup fails

### Evidence from logs

1. **Provider found but model not found**: The `opencode` provider was found (line: `"message":"found","providerID":"opencode"`), but when `resolveShortModelName("kimi-k2.5-free")` was called, it returned `undefined` because the model wasn't in `provider.info.models`.

2. **Stale cache or missing model**: The `kimi-k2.5-free` model definitely exists in the current models.dev API (verified), but the user's cached data may not have contained it.

### Verification

Current models.dev API confirms `kimi-k2.5-free` exists:
```json
{
  "opencode": {
    "id": "opencode",
    "name": "OpenCode Zen",
    "api": "https://opencode.ai/zen/v1",
    "npm": "@ai-sdk/openai-compatible",
    "env": ["OPENCODE_API_KEY"],
    "models": {
      "kimi-k2.5-free": {
        "id": "kimi-k2.5-free",
        "name": "Kimi K2.5 Free",
        "cost": { "input": 0, "output": 0 }
      }
    }
  }
}
```

## Related Issues in Upstream Repository

### OpenCode (anomalyco/opencode)

1. **[#12045](https://github.com/anomalyco/opencode/issues/12045)** - "ProviderModelNotFoundError when using GLM or Kimi"
   - Status: OPEN
   - Similar issue in GitHub Actions workflow

2. **[#11591](https://github.com/anomalyco/opencode/issues/11591)** - "Kimi K2.5 Free OpenCode Zen throws an error"
   - Status: OPEN
   - Different error (JSON Schema validation) but same model

3. **[#3046](https://github.com/sst/opencode/issues/3046)** - "ProviderModelNotFoundError when using Kimi K2 model in GitHub workflow"
   - Status: CLOSED
   - Confirmed similar root cause

## Proposed Solutions

### Solution 1: Await the Refresh Before Model Lookup (Recommended)

Modify `ModelsDev.get()` to await the refresh when the cache is stale or missing:

```typescript
export async function get() {
  const file = Bun.file(filepath);

  // Check if cache exists and is recent (< 1 hour old)
  const exists = await file.exists();
  const stats = exists ? await file.stat() : null;
  const isStale = !stats || Date.now() - stats.mtime.getTime() > 60 * 60 * 1000;

  if (isStale) {
    // AWAIT the refresh for stale/missing cache
    await refresh();
  } else {
    // Trigger background refresh for fresh cache
    refresh();
  }

  const result = await file.json().catch(() => {});
  if (result) return result as Record<string, Provider>;
  const json = await data();
  return JSON.parse(json) as Record<string, Provider>;
}
```

### Solution 2: Better Fallback Error Messages

When a model can't be found, provide helpful suggestions:

```typescript
export async function getModel(providerID: string, modelID: string) {
  // ... existing code ...

  if (!info) {
    const suggestion = await findSimilarModel(modelID);
    throw new ModelNotFoundError({
      providerID,
      modelID,
      suggestion: suggestion || `Run 'agent models --refresh' to update model list`,
      helpUrl: 'https://opencode.ai/docs/troubleshooting/#providermodelnotfounderror'
    });
  }
}
```

### Solution 3: Add `--refresh` Flag for Model List

Allow users to force a refresh of the model database:

```bash
# Refresh models before running
agent --model kimi-k2.5-free --refresh-models

# Or as a separate command
agent models --refresh
```

## Workarounds for Users

### Workaround 1: Use Explicit Provider/Model Format
```bash
echo 'hi' | agent --model opencode/kimi-k2.5-free
```

### Workaround 2: Force Cache Refresh
```bash
rm -rf ~/.cache/link-assistant-agent/models.json
agent models --refresh
echo 'hi' | agent --model kimi-k2.5-free
```

### Workaround 3: Set OPENCODE_API_KEY
```bash
export OPENCODE_API_KEY="your-api-key"
echo 'hi' | agent --model kimi-k2.5-free
```

## References

- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [OpenCode Troubleshooting - ProviderModelNotFoundError](https://opencode.ai/docs/troubleshooting/)
- [Models.dev API](https://models.dev/api.json)
- [Related Issue: anomalyco/opencode#12045](https://github.com/anomalyco/opencode/issues/12045)
- [Related Issue: anomalyco/opencode#11591](https://github.com/anomalyco/opencode/issues/11591)

## Files Involved

- `js/src/provider/models.ts` - Model database loading with race condition
- `js/src/provider/provider.ts` - Provider state and model resolution logic
- `js/src/util/error.ts` - NamedError class for ProviderModelNotFoundError
