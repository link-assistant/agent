# Case Study: AI Agent Premature Termination with `"reason": "unknown"`

## Issue Reference
- **GitHub Issue**: [link-assistant/agent#194](https://github.com/link-assistant/agent/issues/194)
- **Date**: 2026-02-17
- **Summary**: AI model does not implement its own plan and finishes without errors or any actual work

## Executive Summary

The AI agent (GLM-4.7-FREE requested, but Kimi K2.5-FREE used) terminated prematurely after generating a todo list but before executing any of the planned tasks. The finish reason was `"unknown"`, which caused the agent's agentic loop to exit without performing the expected work.

---

## Timeline of Events

### Phase 1: Initialization (12:14:59 - 12:15:15)
| Time | Event |
|------|-------|
| 12:14:59.122Z | Solve.mjs started v1.23.11 |
| 12:14:59.644Z | Command: `--model glm-4.7-free` specified |
| 12:15:05.107Z | Input URL validation: `https://github.com/bpmbpm/rdf-grapher/issues/414` |
| 12:15:15.201Z | Branch created: `issue-414-7c6af804387d` |

### Phase 2: PR Setup (12:15:15 - 12:15:30)
| Time | Event |
|------|-------|
| 12:15:15.342Z | Initial commit created |
| 12:15:23.213Z | Draft PR #419 created |
| 12:15:30.453Z | Agent execution started |

### Phase 3: Model Resolution Mismatch (12:15:31)
| Time | Event | Details |
|------|-------|---------|
| 12:15:31.198Z | **Model mismatch detected** | `rawModel: "opencode/kimi-k2.5-free"` |
| 12:15:31.199Z | **Provider resolved** | `providerID: "opencode"`, `modelID: "kimi-k2.5-free"` |

**Key Observation**: The user requested `--model glm-4.7-free` but the agent resolved to `opencode/kimi-k2.5-free`. This is Issue #192 (model argument mismatch) which was partially fixed but still affects model routing.

### Phase 4: AI Execution (12:15:31 - 12:15:39)
| Time | Event |
|------|-------|
| 12:15:31.245Z | Session prompt loop started (step 0) |
| 12:15:37.756Z | AI initiated `todowrite` tool call |
| 12:15:39.386Z | Todo list created with 7 items |
| 12:15:39.389Z | `todowrite` tool completed |

### Phase 5: Premature Termination (12:15:39)
| Time | Event | Details |
|------|-------|---------|
| 12:15:39.630Z | Text output: "I'll help you solve issue #414..." | |
| 12:15:39.645Z | **step_finish event** | `"reason": "unknown"` |
| 12:15:39.662Z | Loop step 1 started | |
| 12:15:39.662Z | **Loop exiting** | Because `finish !== 'tool-calls'` |

---

## Root Cause Analysis

### Issue 1: Missing `finishReason` from Kimi K2.5 API

The Kimi K2.5 model via OpenCode/OpenRouter returned a response without a proper `finishReason` field. The code handling this is in `processor.ts`:

```typescript
// Line 262-275 in processor.ts
let rawFinishReason = value.finishReason;
if (rawFinishReason === undefined) {
  // Try to extract from OpenRouter provider metadata
  const openrouterMeta = value.providerMetadata?.['openrouter'];
  if (openrouterMeta) {
    if (openrouterMeta['usage']) {
      rawFinishReason = 'stop';
    }
  }
}
const finishReason = Session.toFinishReason(rawFinishReason);
```

The `toFinishReason` function returns `'unknown'` when the value is undefined:

```typescript
// Line 510-513 in session/index.ts
if (value === undefined || value === null) {
  return 'unknown';
}
```

### Issue 2: Agentic Loop Exit Condition

The agentic loop in `prompt.ts` exits when the finish reason is NOT `'tool-calls'`:

```typescript
// Line 275-282 in prompt.ts
if (
  lastAssistant?.finish &&
  lastAssistant.finish !== 'tool-calls' &&
  lastUser.id < lastAssistant.id
) {
  log.info(() => ({ message: 'exiting loop', sessionID }));
  break;
}
```

Since `"unknown"` !== `"tool-calls"`, the loop exits immediately after the first AI response.

### Issue 3: Model Routing (Related to #192)

The user requested `glm-4.7-free` but the system used `kimi-k2.5-free`. While there was a fix for #192 (`getModelFromProcessArgv`), it appears the default model (`opencode/kimi-k2.5-free`) was still used. This is visible in the logs:

```json
{
  "rawModel": "opencode/kimi-k2.5-free",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "using explicit provider/model"
}
```

This happened because:
1. The command was `--model glm-4.7-free` (without provider prefix)
2. The code attempted to resolve this short model name
3. `glm-4.7-free` was not found in any provider's model list
4. The fallback behavior used the default `opencode/kimi-k2.5-free`

---

## Evidence Summary

### Log Evidence

1. **Model requested vs model used**:
   - Requested: `glm-4.7-free`
   - Used: `opencode/kimi-k2.5-free`
   - Responded: `kimi-k2.5`

2. **Step finish with unknown reason**:
```json
{
  "type": "step_finish",
  "part": {
    "reason": "unknown",
    "tokens": { "input": 0, "output": 0, "reasoning": 0 },
    "model": {
      "providerID": "opencode",
      "requestedModelID": "kimi-k2.5-free",
      "respondedModelID": "kimi-k2.5"
    }
  }
}
```

3. **Zero token counts**: The token counts were 0, suggesting the OpenCode/Kimi API did not return usage data properly.

4. **Todo list created but not executed**: The AI created a 7-item todo list but exited before executing any tasks.

---

## Related Issues and Resources

### Internal Issues
1. **#192** - Model argument mismatch (yargs caching issues)
2. **#125** - `finishReason` as object instead of string
3. **#152** - Provider returns invalid usage data
4. **#187** - OpenRouter-compatible APIs may not populate `finishReason`

### External Resources
1. [Kimi K2.5 on OpenRouter](https://openrouter.ai/moonshotai/kimi-k2.5) - Model documentation
2. [OpenRouter AI SDK Provider](https://github.com/OpenRouterTeam/ai-sdk-provider) - Vercel AI SDK integration
3. [Zed Issue #37032](https://github.com/zed-industries/zed/discussions/37032) - Kimi K2 tool calls issues on OpenRouter

---

## Proposed Solutions

### Solution 1: Handle `"unknown"` finish reason as incomplete (Recommended)

**Problem**: The agentic loop treats `"unknown"` the same as `"stop"`, causing premature exit.

**Fix**: In `prompt.ts`, modify the exit condition to continue looping when finish reason is `"unknown"` and there were tool calls pending:

```typescript
// In prompt.ts loop exit condition
const safeFinishReasons = ['stop', 'end-turn', 'max_tokens', 'content_filter'];
if (
  lastAssistant?.finish &&
  safeFinishReasons.includes(lastAssistant.finish) &&
  lastUser.id < lastAssistant.id
) {
  log.info(() => ({ message: 'exiting loop', sessionID }));
  break;
}

// If finish is "unknown", check if there were any tool calls
// If the AI made tool calls, we should continue the loop
if (lastAssistant?.finish === 'unknown') {
  const parts = await MessageV2.parts(lastAssistant.id);
  const hasToolCalls = parts.some(p => p.type === 'tool' && p.state.status === 'completed');
  if (hasToolCalls) {
    log.info(() => ({ message: 'continuing loop due to tool calls with unknown finish', sessionID }));
    // Continue to next iteration - don't break
  }
}
```

### Solution 2: Improve finish reason detection for OpenCode/Kimi

**Problem**: The OpenCode provider doesn't always return `finishReason`.

**Fix**: In `processor.ts`, add more robust finish reason detection:

```typescript
// Enhanced finish reason detection
let rawFinishReason = value.finishReason;
if (rawFinishReason === undefined) {
  // Check providerMetadata for finish reason
  const metadata = value.providerMetadata;

  // Try OpenRouter metadata
  if (metadata?.['openrouter']?.['usage']) {
    rawFinishReason = 'stop';
  }

  // Try OpenCode metadata
  if (metadata?.['opencode']?.['finish_reason']) {
    rawFinishReason = metadata['opencode']['finish_reason'];
  }

  // Infer from response content
  // If we received tool calls, finish reason should be 'tool-calls'
  const pendingToolCalls = Object.keys(toolcalls).length;
  if (pendingToolCalls > 0) {
    rawFinishReason = 'tool-calls';
  }
}
```

### Solution 3: Add `glm-4.7-free` to model mappings

**Problem**: The requested model `glm-4.7-free` doesn't exist in the provider configuration.

**Fix**: Either:
1. Add `glm-4.7-free` as an alias pointing to the correct model
2. Provide a clear error message when a model is not found instead of silently falling back

```typescript
// In provider.ts parseModelWithResolution
const resolved = await resolveShortModelName(model);
if (!resolved) {
  // Instead of silent fallback, throw an informative error
  throw new ModelNotFoundError({
    modelID: model,
    providerID: 'unknown',
    suggestion: `Model "${model}" not found. Did you mean one of: kimi-k2.5-free, glm-5-free, glm-4.5-air-free?`
  });
}
```

### Solution 4: Log warning for model fallback behavior

**Fix**: When the system falls back to a different model than requested, emit a visible warning:

```typescript
if (cliModelArg && cliModelArg !== modelArg) {
  Log.Default.warn(() => ({
    message: 'WARNING: Requested model not found, using fallback',
    requestedModel: cliModelArg,
    fallbackModel: modelArg,
    hint: 'Set AGENT_STRICT_MODEL_MATCHING=true to error instead of fallback'
  }));
}
```

---

## Recommendations

### Immediate Actions
1. **Fix the loop exit condition** to handle `"unknown"` finish reason more robustly
2. **Add model validation** to error clearly when a requested model doesn't exist
3. **Improve logging** to make model fallback behavior visible to users

### Long-term Improvements
1. **Standardize finish reason handling** across all providers with a unified enum
2. **Add integration tests** that verify agentic loop behavior with various finish reasons
3. **Consider reporting to upstream** (OpenCode/OpenRouter) about missing `finishReason` in API responses

---

## External Issue Reporting Candidates

### 1. OpenRouter AI SDK Provider
**Repository**: [OpenRouterTeam/ai-sdk-provider](https://github.com/OpenRouterTeam/ai-sdk-provider)

**Issue Created**: [#420 - Kimi K2.5 returns undefined finishReason after tool calls, breaking agentic loops](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/420)

### 2. Vercel AI SDK
**Repository**: [vercel/ai](https://github.com/vercel/ai)

**Issue**: Consider making `finishReason: "unknown"` continue agentic loops when tool calls were made.

**Suggested Title**: `streamText should treat undefined finishReason as incomplete when tool calls exist`

---

## Files Affected

| File | Role |
|------|------|
| `js/src/session/prompt.ts` | Agentic loop logic (exit condition) |
| `js/src/session/processor.ts` | Finish reason detection |
| `js/src/session/index.ts` | `toFinishReason` conversion |
| `js/src/provider/provider.ts` | Model resolution and routing |
| `js/src/index.js` | Model argument parsing |
| `js/src/cli/argv.ts` | CLI argument extraction |

---

## Conclusion

The premature termination bug is caused by a combination of:
1. Kimi K2.5 API not returning a proper `finishReason` field
2. The agent treating `"unknown"` as a valid completion reason
3. Model routing falling back to a different model than requested

The recommended fix is to update the agentic loop exit condition to:
- Not exit on `"unknown"` finish reason when tool calls were made
- Provide better error messages for model resolution failures
- Add more robust finish reason detection from provider metadata
