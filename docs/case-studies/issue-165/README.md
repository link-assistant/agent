# Case Study: Issue #165 - Support for Kilo Models Didn't Work

## Summary

When a user requested `kilo/glm-5-free` model through the `solve` CLI tool, the @link-assistant/agent system incorrectly routed the request to `opencode/kimi-k2.5-free` instead, causing OpenCode Zen to execute with the wrong model.

## Timeline of Events

| Timestamp | Event |
|-----------|-------|
| 2026-02-13T22:53:24.795Z | User executed: `solve https://github.com/netkeep80/aprover/issues/10 --tool agent --model kilo/glm-5-free` |
| 2026-02-13T22:53:58.334Z | Agent CLI reports: `Model: kilo/glm-5-free` |
| 2026-02-13T22:53:58.380Z | Raw command executed with correct model parameter |
| 2026-02-13T22:53:59.098Z | Provider state initialization begins |
| 2026-02-13T22:53:59.098Z | **ISSUE**: `providerID: "opencode"` found first |
| 2026-02-13T22:53:59.098Z | `providerID: "kilo"` found second |
| 2026-02-13T22:53:59.107Z | **FAILURE**: `getModel` called with `providerID: "opencode"`, `modelID: "kimi-k2.5-free"` |
| 2026-02-13T22:53:59.178Z | OpenCode SDK loaded instead of Kilo SDK |
| 2026-02-13T22:53:59.660Z | API call made to `https://opencode.ai/zen/v1/chat/completions` with wrong model |

## Root Cause Analysis

### Primary Root Cause: Default Model Fallback Override

The @link-assistant/agent's `Provider.defaultModel()` function in `provider.ts` (lines 1321-1366) prioritizes the `opencode` provider when available, regardless of the user's explicitly specified model:

```typescript
// In Provider.defaultModel()
const opencodeProvider = providers.find((p) => p.info.id === 'opencode');
if (opencodeProvider) {
  const [model] = sort(Object.values(opencodeProvider.info.models));
  if (model) {
    log.info(() => ({
      message: 'using opencode provider as default',
      provider: opencodeProvider.info.id,
      model: model.id,
    }));
    return {
      providerID: opencodeProvider.info.id,
      modelID: model.id,
    };
  }
}
```

The `sort()` function (lines 1309-1319) prioritizes free models:
```typescript
const priority = [
  'glm-5-free',
  'kimi-k2.5-free',  // <-- This gets selected as fallback
  'minimax-m2.1-free',
  ...
];
```

### Secondary Root Cause: Model Parsing Logic Issue

When the CLI passes `--model kilo/glm-5-free`, the `parseModel()` function correctly parses it:
```typescript
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split('/');
  return {
    providerID: providerID,  // "kilo"
    modelID: rest.join('/'), // "glm-5-free"
  };
}
```

However, somewhere in the execution flow, the explicitly specified model is being overridden by the default model logic.

### Evidence from Logs

1. **User intent**: `--model kilo/glm-5-free`
2. **What agent displayed**: `Model: kilo/glm-5-free` (correct in display)
3. **What was actually used**: `opencode/kimi-k2.5-free` (incorrect in execution)

The logs show:
```json
{
  "service": "provider",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "getModel"
}
```

This indicates the model routing logic is being bypassed or overridden before the actual API call.

## Contributing Factors

1. **Provider Initialization Order**: The `opencode` provider is checked and found before `kilo`, and is auto-loaded due to having free models available.

2. **Small Model Priority for OpenCode**: The `getSmallModel()` function specifically prioritizes `kimi-k2.5-free` for the `opencode` provider (line 1274-1281):
   ```typescript
   if (providerID === 'opencode' || providerID === 'local') {
     priority = [
       'kimi-k2.5-free',
       'minimax-m2.1-free',
       ...
     ];
   }
   ```

3. **Both Providers Share Similar Free Models**: Both `kilo` and `opencode` providers have `kimi-k2.5-free` defined, potentially causing confusion in model resolution.

## Impact

- Users cannot reliably use the Kilo Gateway provider
- GLM-5 model (a flagship free model from Z.AI) is inaccessible despite being explicitly requested
- The bug breaks the principle of explicit user choice
- Trust in the model selection system is compromised

## Proposed Solutions

### Solution 1: Fix Model Override Logic (Recommended)

Modify the agent's model selection to respect explicitly specified models and only fall back to defaults when no model is specified.

**Location**: `js/src/session/prompt.ts` or wherever the model is finally resolved

**Change**:
```typescript
// Before making API call, verify the model matches user's request
const userSpecifiedModel = parseModel(config.model);
if (userSpecifiedModel.providerID !== resolvedModel.providerID ||
    userSpecifiedModel.modelID !== resolvedModel.modelID) {
  log.warn(() => ({
    message: 'model mismatch detected',
    requested: config.model,
    resolved: `${resolvedModel.providerID}/${resolvedModel.modelID}`,
  }));
  // Use user-specified model instead
  resolvedModel = await Provider.getModel(
    userSpecifiedModel.providerID,
    userSpecifiedModel.modelID
  );
}
```

### Solution 2: Add Explicit Model Validation

Add validation in the `defaultModel()` function to check if a specific model was requested:

```typescript
export async function defaultModel(requestedModel?: string) {
  // If user explicitly specified a model, use it
  if (requestedModel) {
    return parseModel(requestedModel);
  }

  // Otherwise, proceed with default logic
  // ...existing code...
}
```

### Solution 3: Provider Isolation

Ensure that when `kilo/glm-5-free` is requested, only the Kilo provider's models are considered:

```typescript
export async function getModel(providerID: string, modelID: string) {
  const key = `${providerID}/${modelID}`;
  const s = await state();

  // Strict provider matching - do not fall back to other providers
  const provider = s.providers[providerID];
  if (!provider) {
    throw new ModelNotFoundError({
      providerID,
      modelID,
      suggestion: `Provider '${providerID}' not found. Check your API key configuration.`
    });
  }
  // ...continue with model resolution...
}
```

## Workarounds

### Workaround 1: Set KILO_API_KEY Environment Variable

```bash
export KILO_API_KEY="your-api-key"
solve https://github.com/owner/repo/issues/123 --model kilo/glm-5-free
```

This may force the Kilo provider to take precedence.

### Workaround 2: Disable OpenCode Provider

In your agent config file (`~/.config/link-assistant-agent/config.json`):
```json
{
  "disabled_providers": ["opencode"]
}
```

### Workaround 3: Use OpenRouter Instead

```bash
solve https://github.com/owner/repo/issues/123 --model openrouter/z-ai/glm-5
```

OpenRouter provides access to GLM-5 and may have more reliable routing.

## Related Issues & Resources

### External References
- [Kilo Gateway Documentation](https://kilo.ai/docs/gateway)
- [GLM-5 Free on Kilo (Limited Time)](https://blog.kilo.ai/p/glm-5-free-limited-time)
- [Z.AI GLM-5 Model Info](https://kilo.ai/models/z-ai-glm-5)
- [Kimi K2.5 Model Routing Issues](https://github.com/anomalyco/opencode/issues/1265)

### Related Issues in Other Repositories
- OpenCode Issue #12614: [OpenRouter Model like kimi k2 2.5 e Qwen3 coder next not available](https://github.com/anomalyco/opencode/issues/12614)
- OpenCode Issue #1265: [If Kimi k2.5 model is used for main agent, all subagents inherit the Kimi model](https://github.com/code-yeongyu/oh-my-opencode/issues/1265)
- OpenCode Issue #11917: [Kimi K2.5 model ID bypasses reasoning variants exclusion](https://github.com/anomalyco/opencode/issues/11917)

## Data Files

- [`data/solve-log.txt`](data/solve-log.txt) - Complete execution log (renamed from .log to avoid gitignore)
- [`data/provider.ts`](data/provider.ts) - Provider implementation (snapshot)
- [`data/agent.ts`](data/agent.ts) - Agent implementation (snapshot)

## Conclusion

The root cause is a design flaw in the model selection logic that prioritizes the `opencode` provider and its default model (`kimi-k2.5-free`) over explicitly user-specified models from other providers like `kilo`. This is a **bug in @link-assistant/agent** that needs to be fixed in the provider/model resolution logic.

The fix should ensure that:
1. User-specified models always take precedence over defaults
2. Model parsing correctly passes through the entire execution chain
3. Provider isolation is maintained when a specific provider is requested
