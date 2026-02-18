# Case Study: Issue #198 - "Find a way to make it work already"

## Summary

The agent fails silently when using free models (e.g., `glm-5-free` via Kilo, `kimi-k2.5-free` via OpenCode). The provider returns zero tokens with an "unknown" finish reason, and the agent exits without producing any output. Multiple compounding bugs prevent proper error handling and model routing.

## Timeline / Sequence of Events

1. User runs: `solve --model glm-5-free --tool agent --verbose`
2. solve.mjs maps `glm-5-free` → `kilo/glm-5-free` and invokes: `agent --model kilo/glm-5-free --verbose`
3. **Bug 1**: `getModelFromProcessArgv()` should detect `--model kilo/glm-5-free` from process.argv, but the log shows `rawModel: "opencode/kimi-k2.5-free"` (the yargs default) was used instead. This means the CLI model argument was not picked up.
4. **Bug 2**: Model validation in `model-config.js:66` calls `Provider.state()`, but `state` is not exported from the `Provider` namespace. The `TypeError` is caught silently, so model existence validation is always skipped.
5. Agent proceeds with `opencode/kimi-k2.5-free` (Kimi K2.5 via OpenCode provider).
6. **Bug 3**: The OpenCode provider's API call for `kimi-k2.5-free` returns zero tokens with `finishReason: undefined` (converted to `"unknown"`). The responded model ID is `moonshotai/kimi-k2.5`.
7. The session loop detects zero tokens + unknown finish reason and logs an error, then breaks.
8. No output is produced. The session ends silently.

## Root Causes

### Root Cause 1: `Provider.state` Not Exported

**Location**: `js/src/provider/provider.ts:690`

```typescript
const state = Instance.state(async () => { ... });
```

The `state` variable is a local `const` inside the `Provider` namespace. It is NOT exported with `export const state = ...`. When `model-config.js` does:

```javascript
const { Provider } = await import('../provider/provider.ts');
const s = await Provider.state(); // TypeError: Provider.state is not a function
```

...it always throws, and the catch block silently skips validation.

**Impact**: Model existence validation never works. Invalid or non-existent models silently proceed to API calls, where they fail with confusing "unknown reason" / zero-token errors.

### Root Cause 2: Model Argument Not Picked Up from CLI

**Location**: `js/src/cli/model-config.js` and `js/src/cli/argv.ts`

The `getModelFromProcessArgv()` function should parse `--model kilo/glm-5-free` from `process.argv`, but it returned `null` in this case. The yargs default `opencode/kimi-k2.5-free` was used instead.

Possible causes:
- Bun's handling of `process.argv` when running via piped stdin may differ from Node.js
- The argv parsing may be affected by the `cat prompt.txt | agent` invocation pattern

**Impact**: User's explicit `--model` choice is silently ignored. The wrong model/provider is used.

### Root Cause 3: Zero-Token Provider Response Not Properly Surfaced

**Location**: `js/src/session/prompt.ts:289-311` and `js/src/session/processor.ts`

When a provider returns zero tokens with unknown finish reason, the error is logged but:
- No retry mechanism is attempted
- No user-facing error message explains what happened
- No raw request/response data is logged for debugging
- The agent just silently exits

**Impact**: Users see "no tokens" without understanding why or having any recourse.

## Evidence from Logs

### Key log entries:

```
"reason": "Provider.state is not a function. (In 'Provider.state()', 'Provider.state' is undefined)"
"message": "skipping model existence validation"
```

```
"rawModel": "opencode/kimi-k2.5-free",
"providerID": "opencode",
"modelID": "kimi-k2.5-free",
"message": "using explicit provider/model"
```

```
"finishReason": "unknown",
"tokens": { "input": 0, "output": 0, "reasoning": 0 },
"message": "provider returned zero tokens with unknown finish reason - possible API failure"
```

```
"requestedModelID": "kimi-k2.5-free",
"respondedModelID": "moonshotai/kimi-k2.5"
```

## Fixes Applied

### Fix 1: Export `Provider.state` from the namespace

Changed `const state = ...` to `export const state = ...` in `provider.ts`, so model validation in `model-config.js` can actually call `Provider.state()`.

### Fix 2: Improved zero-token error handling

When zero tokens + unknown finish reason is detected:
- Log the raw model info (requested vs responded model ID)
- Emit a structured error event so the JSON standard output includes the error
- Include actionable guidance (check API key, model availability, provider status)

### Fix 3: Added verbose request/response logging

When `--verbose` is enabled, log:
- The actual model ID being sent to the provider API
- Provider endpoint URL
- Response status and any error details from the provider

## Related Issues

- Issue #194: Unknown finish reason with tool calls
- Issue #196: Zero tokens with unknown finish reason
- Issue #192: Yargs caching / model argument mismatch

## References

- [Kilo AI](https://github.com/Kilo-Org/kilo) - Provider proxy for free models
- [OpenCode](https://github.com/anomalyco/opencode) - Provider for free models via models.dev
- [Vercel AI SDK](https://github.com/vercel/ai) - Underlying AI SDK used by the agent
