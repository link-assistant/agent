# Case Study: Issue #196 - Model Substitution and Unknown Finish Reason

## Issue Reference
- **Issue:** https://github.com/link-assistant/agent/issues/196
- **Date:** 2026-02-18
- **Agent version:** 0.16.4
- **Reporter:** @konard

## Summary

User requested `agent --model glm-4.7-free` but the system silently substituted it with `opencode/kimi-k2.5-free` (the default model). The substituted model then returned a response with `"reason": "unknown"` and zero tokens, indicating a complete API communication failure.

## Timeline of Events

```
12:39:15.827Z - Solve script receives: --model glm-4.7-free
12:39:45.551Z - Solve script executes: agent --model opencode/glm-4.7-free --verbose
                (solve script prepends "opencode/" provider prefix)
12:39:46.213Z - Agent starts, process.argv contains: --model opencode/glm-4.7-free
12:39:46.242Z - parseModelConfig logs: rawModel="opencode/kimi-k2.5-free"
                *** MODEL SUBSTITUTION OCCURRED ***
                Expected: opencode/glm-4.7-free
                Actual:   opencode/kimi-k2.5-free (yargs default value)
12:39:46.416Z - Provider resolves: opencode/kimi-k2.5-free -> moonshotai/kimi-k2.5
12:39:53.236Z - API returns: reason="unknown", tokens={input:0, output:0}
                *** ZERO TOKEN RESPONSE ***
```

## Root Cause Analysis

### Root Cause 1: Model Argument Not Parsed from CLI (Yargs/Bun Issue)

**Evidence:** The command line contains `--model opencode/glm-4.7-free` (line 263 of log) but `parseModelConfig()` received `modelArg = "opencode/kimi-k2.5-free"` (line 330) — the yargs default value.

**Mechanism:**
- The yargs default for `--model` is `opencode/kimi-k2.5-free` (js/src/index.js:624)
- When running under Bun, yargs may fail to parse `--model` correctly in some scenarios
- The `getModelFromProcessArgv()` safeguard (added in PR #193 for issue #192) should have caught this, but either returned null or wasn't effective
- No "model argument mismatch detected" warning appeared in the log, suggesting `getModelFromProcessArgv()` returned null

**Why the safeguard failed:** The `getModelFromProcessArgv()` function checks `process.argv` directly. In Bun, `process.argv` may have different structure depending on how the script is invoked (direct vs via bun binary).

### Root Cause 2: No Model Existence Validation for Explicit Provider/Model Format

**Evidence:** Even if `opencode/glm-4.7-free` had been correctly parsed, the code at `parseModelConfig()` lines 157-175 does NOT validate that the model actually exists in the provider. It simply splits on `/` and uses the result.

**Mechanism:**
- `parseModelConfig()` takes the explicit `provider/model` path when the string contains `/`
- This path does NOT call `parseModelWithResolution()` which has model existence checks
- The model `glm-4.7-free` was deprecated from OpenCode (per MODELS.md and CHANGELOG.md)
- The code would have sent a request to the provider for a non-existent model

### Root Cause 3: Provider Returns Empty Response for Non-Existent/Error Model

**Evidence:** The `step_finish` event shows:
```json
{
  "reason": "unknown",
  "cost": 0,
  "tokens": { "input": 0, "output": 0, "reasoning": 0 },
  "model": {
    "providerID": "opencode",
    "requestedModelID": "kimi-k2.5-free",
    "respondedModelID": "moonshotai/kimi-k2.5"
  }
}
```

The OpenCode provider returned a response with zero tokens and an unknown finish reason, possibly indicating:
1. The model was rate-limited or temporarily unavailable
2. The API request failed silently without a proper error response
3. The provider mapped `kimi-k2.5-free` to `moonshotai/kimi-k2.5` but the response was empty

## Two Distinct Problems

| # | Problem | Impact | Existing Mitigation | Gap |
|---|---------|--------|--------------------|----|
| 1 | Model substitution: user gets wrong model | High - wastes tokens on wrong model, produces wrong results | `getModelFromProcessArgv()` safeguard from PR #193 | Safeguard fails in some Bun invocation modes |
| 2 | Zero-token unknown response not treated as error | Medium - agent exits silently without work | `toFinishReason()` converts to "unknown", loop exits if no tool calls | No detection of zero-token responses as errors requiring retry |

## Fixes Implemented

### Fix 1: Validate Model Exists in Provider for Explicit Format
- Added model existence validation in `parseModelConfig()` for the explicit `provider/model` path
- If the model doesn't exist in the provider, throws `ModelNotFoundError` with helpful suggestion
- This ensures that even if yargs/bun misparses the model arg, the system won't silently use a non-existent model

### Fix 2: Detect and Handle Zero-Token Responses
- Added detection of zero-token responses with unknown finish reason in `prompt.ts`
- When all tokens are 0 and reason is "unknown", this is treated as a provider communication failure
- The step is logged as an error with a clear message explaining what happened
- The loop exits with appropriate error handling instead of silently failing

### Fix 3: Strengthen getModelFromProcessArgv Safeguard
- Enhanced `getModelFromProcessArgv()` to also check short forms and common Bun argv patterns
- Added logging when the safeguard activates to make debugging easier

## Related Issues

- Issue #192: Yargs caching mismatch for model argument
- Issue #194: AI agent terminated prematurely with "reason": "unknown"
- Issue #171: Model routing diagnostic improvements

## Data Files

- `full-log.txt` - Complete solve.mjs log from the incident
