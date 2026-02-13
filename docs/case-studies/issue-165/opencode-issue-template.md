# Issue Template for sst/opencode

## Title

Explicit model specification ignored - kilo/glm-5-free routed to opencode/kimi-k2.5-free

## Labels

bug, provider, model-routing

## Description

### Summary

When specifying `--model kilo/glm-5-free` in the CLI, the request is incorrectly routed to `opencode/kimi-k2.5-free` instead.

### Steps to Reproduce

1. Ensure the Kilo provider is available (KILO_API_KEY not required for free models)
2. Run the agent CLI with explicit Kilo model:
   ```bash
   agent --model kilo/glm-5-free --verbose
   ```
3. Observe the actual model used in the API request

### Expected Behavior

- API requests should be made to Kilo Gateway at `https://api.kilo.ai/api/gateway`
- The model `z-ai/glm-5` should be used (Kilo's internal ID for glm-5-free)
- User-specified model should take precedence over defaults

### Actual Behavior

- API requests are made to OpenCode Zen at `https://opencode.ai/zen/v1/chat/completions`
- The model `kimi-k2.5-free` is used instead
- User-specified model is ignored

### Log Evidence

```json
// Requested
{
  "command": "agent --model kilo/glm-5-free --verbose"
}

// Actual (from verbose logs)
{
  "service": "provider",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "getModel"
}
```

### Root Cause Analysis

The `Provider.defaultModel()` function in `provider.ts` prioritizes the `opencode` provider when available, regardless of user's explicit model specification:

```typescript
// In defaultModel()
const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
if (opencodeProvider) {
  // This overrides user's explicit model choice
  const [model] = sort(Object.values(opencodeProvider.info.models));
  if (model) {
    return {
      providerID: opencodeProvider.info.id,
      modelID: model.id,
    };
  }
}
```

### Proposed Fix

Modify the model resolution logic to:
1. Check if a specific model was explicitly requested
2. Only use `defaultModel()` when no model is specified
3. Validate that the resolved model matches the user's request before making API calls

```typescript
export async function defaultModel(requestedModel?: string) {
  // If user explicitly specified a model, use it directly
  if (requestedModel) {
    return parseModel(requestedModel);
  }

  // Otherwise, proceed with default selection logic
  // ...existing code...
}
```

### Environment

- Agent Version: 0.12.0
- Node Version: v20.20.0
- Platform: Linux
- Date: 2026-02-13

### Related Issues

- #12614 - OpenRouter Model like kimi k2 2.5 not available
- #1265 - If Kimi k2.5 model is used for main agent, all subagents inherit the Kimi model
- #11917 - Kimi K2.5 model ID bypasses reasoning variants exclusion

### Workarounds

1. **Set KILO_API_KEY** - May force Kilo provider to take precedence
2. **Disable OpenCode provider** - Add `{"disabled_providers": ["opencode"]}` to config
3. **Use OpenRouter** - `--model openrouter/z-ai/glm-5` as alternative

### Additional Context

Full execution log available at: https://gist.github.com/konard/d39b02783f0402ca929e6bf85ae89274

Case study analysis: https://github.com/link-assistant/agent/blob/main/docs/case-studies/issue-165/README.md
