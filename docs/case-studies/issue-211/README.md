# Case Study: Issue #211 - Missing HTTP Verbose Output and Empty Provider Usage Data

**Issue**: [#211](https://github.com/link-assistant/agent/issues/211)
**Date**: 2026-03-09
**Status**: Resolved

## Summary

When running the Agent CLI with `--verbose` mode and the `opencode/minimax-m2.5-free` model, two problems were observed:

1. **No HTTP request/response logging** appeared in verbose output despite `--verbose` being enabled
2. **"Provider returned zero tokens with unknown finish reason"** error — the model actually worked (generated tool calls and responses) but token usage was reported as zero and finish reason as undefined

## Evidence

### Raw Log Analysis

Full session log: [`verbose-session-log.txt`](./verbose-session-log.txt)

Key observations from the log:

- **Command**: `agent --model opencode/minimax-m2.5-free --verbose`
- **Model worked correctly**: Generated tool calls (`bash`), executed commands, produced valid responses
- **8-second gap** between `step_start` (15:50:49.891Z) and `tool_use` (15:50:57.282Z) with NO HTTP log entries
- **`rawUsage`** at line 1086: `{"inputTokenDetails":{},"outputTokenDetails":{}}` — empty
- **`providerMetadata`** at line 1087: `{"anthropic":{"usage":{"input_tokens":14533,"output_tokens":164,...}}}` — has valid data
- **Error** at line 1213: "Provider returned zero tokens with unknown finish reason. Requested model: unknown (provider: unknown). Responded model: unknown."

## Root Cause Analysis

### Root Cause 1: HTTP Verbose Logging Not Appearing

**Location**: `js/src/provider/provider.ts` lines 1272-1396

The verbose HTTP logging wrapper in `getSDK()` used **lazy log calls**:

```javascript
// BEFORE (not working)
log.info(() => ({
  message: 'HTTP request',
  providerID: provider.id,
  method,
  url,
  headers: sanitizedHeaders,
  bodyPreview,
}));
```

This pattern passes a callback function to `log.info()`. Inside `Log.create()` (`js/src/util/log.ts` line 286-299), when the message is a function, it delegates to `lazyLogInstance.info()` from the `log-lazy` npm package.

The lazy logging chain is:
1. `log.info(callback)` → detects function argument
2. Delegates to `lazyLogInstance.info(wrappedCallback)` (from `log-lazy` npm package)
3. `log-lazy` checks bit flags to determine if level is enabled
4. If enabled, calls `wrappedCallback()` which calls original `callback()` and passes result to `output()`
5. `output()` uses `console.log()` by default

The issue: when the Agent CLI runs as a subprocess (via `solve.mjs`), stdout output from `console.log()` within nested lazy callbacks can be lost or interleaved. The lazy evaluation adds indirection that makes the output timing unpredictable.

However, the verbose wrapper already has a guard at the top:

```javascript
if (!Flag.OPENCODE_VERBOSE) {
  return innerFetch(input, init);
}
```

This means by the time we reach the log calls, we **already know** verbose mode is enabled. The lazy evaluation provides no benefit here since:
- The expensive work (computing headers, body preview) is already done
- The verbose check is already performed

**Fix**: Changed all 5 HTTP log call sites from lazy to direct calls:

```javascript
// AFTER (working)
log.info('HTTP request', {
  providerID: provider.id,
  method,
  url,
  headers: sanitizedHeaders,
  bodyPreview,
});
```

When the first argument is a string, `Log.create()` immediately calls `output('INFO', message, extra)` which writes to stdout synchronously, bypassing the lazy logging chain entirely.

### Root Cause 2: Empty Token Usage and Unknown Finish Reason

**Location**: `js/src/session/index.ts` lines 630-664 (`getUsage()` function)

The `opencode/minimax-m2.5-free` model is configured at `models.dev` with:
- Provider-level: `npm: @ai-sdk/openai-compatible`, `api: https://opencode.ai/zen/v1`
- Model-level override: `provider.npm: @ai-sdk/anthropic` (uses Anthropic SDK)

When `@ai-sdk/anthropic` is used with a custom `baseURL` (opencode proxy), the API returns usage data in **Anthropic-specific metadata** format:

```json
{
  "providerMetadata": {
    "anthropic": {
      "usage": {
        "input_tokens": 14533,
        "output_tokens": 164,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0
      }
    }
  }
}
```

But the standard AI SDK `usage` object was empty:

```json
{
  "usage": {
    "inputTokens": undefined,
    "outputTokens": undefined
  }
}
```

The `getUsage()` function had a fallback for **OpenRouter** metadata (which uses `promptTokens`/`completionTokens` camelCase keys) but **no fallback for Anthropic** metadata (which uses `input_tokens`/`output_tokens` snake_case keys).

**Fix**: Added an Anthropic metadata fallback in `getUsage()`:

```typescript
// If still empty, try providerMetadata.anthropic.usage as fallback
if (standardUsageIsEmpty && !openrouterUsage) {
  const anthropicUsage = input.metadata?.['anthropic']?.['usage'];
  if (anthropicUsage && (anthropicUsage.input_tokens || anthropicUsage.output_tokens)) {
    effectiveUsage = {
      ...input.usage,
      inputTokens: anthropicUsage.input_tokens ?? 0,
      outputTokens: anthropicUsage.output_tokens ?? 0,
      cachedInputTokens: anthropicUsage.cache_read_input_tokens ?? 0,
    };
  }
}
```

Also extended the `standardUsageIsEmpty` check to cover providers that set tokens to `0` instead of `undefined`:

```typescript
const standardUsageIsEmpty =
  (input.usage.inputTokens === undefined &&
    input.usage.outputTokens === undefined) ||
  (input.usage.inputTokens === 0 &&
    input.usage.outputTokens === 0 &&
    !input.usage.totalTokens);
```

## Timeline / Sequence of Events

1. User runs `agent --model opencode/minimax-m2.5-free --verbose`
2. CLI middleware sets `Flag.OPENCODE_VERBOSE = true` and calls `Log.init()`
3. `getSDK()` creates SDK instance with `@ai-sdk/anthropic` package (from model-level override in models.dev)
4. Verbose fetch wrapper is installed around the SDK's fetch function
5. `streamText()` calls the model API through the fetch wrapper
6. **HTTP request is made** — but verbose log uses lazy callback → output lost in subprocess piping
7. API responds with valid content (tool calls, text responses)
8. **Usage data arrives** in `providerMetadata.anthropic.usage` (snake_case) but standard `usage` object is empty
9. `getUsage()` finds empty standard usage, checks OpenRouter fallback (not present), **skips Anthropic fallback (didn't exist)**
10. Reports 0 tokens → triggers "zero tokens with unknown finish reason" error
11. Despite the error, the model response was valid and tool calls executed successfully

## Comparison with Upstream

### OpenCode (https://github.com/anomalyco/opencode)

OpenCode works because:
- It uses the same AI SDK but may have different provider configurations
- The models.dev API configuration for opencode provider models works correctly with their codebase
- They may handle provider metadata differently or use models that populate standard usage

### KiloCode (https://github.com/Kilo-Org/kilocode)

KiloCode is a VS Code extension that:
- Uses a different architecture (VS Code extension vs CLI)
- Has its own provider abstraction layer
- May not rely on the same `getUsage()` path for token tracking

### Key Difference

The link-assistant/agent fork added robust error reporting for zero-token scenarios (issue #119, #125, #127, #129) which correctly identified the problem but didn't have the Anthropic metadata fallback to recover from it. The upstream OpenCode may either:
1. Not have the zero-token check, silently ignoring the issue
2. Use models that populate standard usage correctly
3. Have a different metadata extraction path

## Files Changed

| File | Change | Purpose |
|------|--------|---------|
| `js/src/provider/provider.ts` | 5 log calls: lazy → direct | Fix HTTP verbose output not appearing |
| `js/src/session/index.ts` | Added anthropic metadata fallback | Fix zero tokens from anthropic-proxied providers |
| `js/tests/session-usage.test.ts` | Added 7 new test cases | Verify anthropic metadata fallback behavior |

## Additional Findings

### SDK Hash Collision (Latent Bug)

In `getSDK()`, SDK instances are cached using `JSON.stringify({ pkg, options })` as the hash key. Since `JSON.stringify` strips function properties, all SDK options with the same non-function properties hash to the same key. This is a latent bug that could cause issues if different SDK configurations only differ by their fetch wrapper functions. Not the direct cause of this issue, but worth tracking.

### Duplicate Import in log-lazy.ts

`js/src/util/log-lazy.ts` has a duplicate `import { Flag } from '../flag/flag'` on lines 2 and 56. This is a pre-existing issue that doesn't affect runtime behavior but should be cleaned up.

## References

- Issue: https://github.com/link-assistant/agent/issues/211
- PR: https://github.com/link-assistant/agent/pull/212
- Session log (gist): https://gist.githubusercontent.com/konard/c79d74b474da8982ea390cd6a932e235/raw/2dbfd931fb59f5fce22ab499b4f0de186d7cadd6/solution-draft-log-pr-1773071461419.txt
- models.dev API: https://models.dev/api.json
- AI SDK docs: https://sdk.vercel.ai/docs
- log-lazy package: https://www.npmjs.com/package/log-lazy
