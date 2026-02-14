# Case Study: Premature Session Termination Due to SSE Stream Corruption (Issue #169)

## Summary

The agent's session terminated after ~5 minutes instead of retrying for the expected 7-day window. The root cause is a chain of three failures:

1. **SSE stream corruption** at the OpenCode Zen gateway level when proxying responses from Moonshot's Kimi K2.5 API
2. **Vercel AI SDK** emitting `{ type: 'error', error: JSONParseError }` into the stream (does NOT throw — allows stream to continue)
3. **Agent's processor** (`processor.ts:208`) throwing `value.error` on any stream error event, terminating the session

## Infrastructure Chain

From the log file (`original-log.txt`), the provider was resolved as follows:

```
Agent (Bun) → OpenCode Zen (opencode.ai/zen/v1) → Moonshot Kimi K2.5 API
```

Evidence from logs:

```
[2026-02-14T08:29:06.525Z] "providerID": "opencode",
[2026-02-14T08:29:06.525Z] "modelID": "kimi-k2.5-free",
[2026-02-14T08:29:06.525Z] "message": "using explicit provider/model"
```

```
[2026-02-14T08:29:06.628Z] "pkg": "@ai-sdk/openai-compatible",
```

- **Provider ID**: `opencode` (resolved from `--model kimi-k2.5-free` via `resolveShortModelName()` in `provider.ts:1452`)
- **SDK**: `@ai-sdk/openai-compatible`
- **Base URL**: `https://opencode.ai/zen/v1` (from models.dev database for the "opencode" provider)
- **Model ID sent to API**: `kimi-k2.5-free` (from models.dev `opencode.models["kimi-k2.5-free"].id`)
- **API Key**: `"public"` (free model, no API key needed — see `provider.ts:87`)

### Why "opencode" provider, not "kilo"?

The model `kimi-k2.5-free` exists in **both** the `opencode` and `kilo` providers. The resolution logic in `provider.ts:1450-1458` prefers `opencode` for shared models:

```typescript
// provider.ts:1450-1458
// Multiple providers have this model - prefer OpenCode for shared free models
if (matchingProviders.includes('opencode')) {
  return { providerID: 'opencode', modelID };
}
```

**The Kilo AI Gateway (`api.kilo.ai`) is NOT involved in this incident.** The previous analysis incorrectly stated Kilo was in the chain. The actual gateway is OpenCode Zen (`opencode.ai/zen/v1`).

## Timeline of Events

All timestamps from `original-log.txt`:

| Time (UTC) | Event | Evidence |
|------------|-------|----------|
| 08:28:32 | Process started | `solve v1.23.1`, `--model kimi-k2.5-free` |
| 08:29:06.525 | Provider resolved | `"providerID": "opencode"`, `"modelID": "kimi-k2.5-free"` |
| 08:29:06.628 | SDK loaded | `"pkg": "@ai-sdk/openai-compatible"` |
| 08:29:08.662 | Rate limit 429 | `"headerValue": 55852` → retry-after ~15.5 hours |
| 08:29:08–08:30:31 | Multiple 429s | Correct retry-after handling |
| 08:33:41.604 | Session 2 started | Same provider: `"providerID": "opencode"` |
| 08:34:12.210 | **Stream error** | `"name": "AI_JSONParseError"`, `"text": "{\"id\":\"chatcmpl-jQugNdata:..."` |
| 08:34:12.211 | Error classified | `"name": "UnknownError"` — not retryable |
| 08:34:12.213 | Tool aborted | `"error": "Tool execution aborted"` (side effect) |
| 08:34:12.293 | Solve script exit | Misclassified as `UsageLimit` |

## Root Cause Analysis

### Root Cause 1: Malformed SSE Data from OpenCode Zen

The SSE stream returned corrupted data where two SSE chunks were concatenated without proper delimiters. From the log:

```json
"text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",\"object\":\"chat.completion.chunk\",\"created\":1771058051,\"model\":\"kimi-k2.5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}],\"system_fingerprint\":\"fpv0_f7e5c49a\"}"
```

Breaking this down:
- `{"id":"chatcmpl-jQugN` — partial first chunk (truncated after the `id` value)
- `data:` — SSE protocol prefix that should start a new line
- `{"id":"chatcmpl-iU6vk...` — complete second chunk

Expected (correct SSE format):
```
data: {"id":"chatcmpl-jQugN","object":"chat.completion.chunk",...}\n\n
data: {"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk",...}\n\n
```

The `data:` prefix of the second event is embedded inside the first event's JSON value, indicating SSE chunk boundary corruption at the gateway level.

Similar issues reported in other projects:
- [OpenCode #7692](https://github.com/anomalyco/opencode/issues/7692): "JSON Parse Error with Zhipu GLM-4.7"
- [OpenCode #10967](https://github.com/anomalyco/opencode/issues/10967): "Error Writing Large Files with Kimi K2.5"
- [sglang #8613](https://github.com/sgl-project/sglang/issues/8613): "Kimi-K2 model outputs incomplete content during multi-turn streaming"

### Root Cause 2: Agent's Processor Throws on All Stream Error Events

The Vercel AI SDK handles this error correctly — it:
1. Catches JSON parse failure in `safeParseJSON()` (returns `{ success: false }`)
2. In `openai-compatible-chat-language-model.ts:417-420`, enqueues `{ type: 'error', error: chunk.error }` and **returns** — the stream continues processing subsequent chunks

However, the agent's `processor.ts:207-208` throws on **any** stream error event:

```typescript
case 'error':
  throw value.error;
```

This converts a recoverable stream event into a fatal session error. The error then flows to `fromError()` in `message-v2.ts`, where `AI_JSONParseError` (which extends `Error`) falls through to `NamedError.Unknown` — which is not retryable.

### Root Cause 3: Solve Script Error Misclassification

The external solve script detected "Tool execution aborted" (a side effect — in-flight tool calls are marked "aborted" when the stream errors out) and misclassified it as `UsageLimit`, preventing any further retry at the script level.

## Comparison with Other CLI Agents

| Agent | JSON parse error in SSE | Stream continues? | Source |
|-------|------------------------|-------------------|--------|
| **OpenAI Codex** (Rust) | `debug!("Failed to parse SSE event"); continue;` | Yes — skip & continue | `codex-api/src/sse/responses.rs:373-379` |
| **Gemini CLI** | `throw e;` in `@google/genai` SDK | No — stream terminates | `@google/genai` `Stream.fromSSEResponse()` |
| **Qwen Code** | SDK JSONL: `return null` (skip). OpenAI path: no safe parse | Partial — only SDK JSONL mode | `sdk-typescript/src/utils/jsonLines.ts` |
| **OpenCode** (upstream) | Falls to `NamedError.Unknown` | No — session terminates | `session/message-v2.ts:fromError()` |
| **Vercel AI SDK** | `safeParseJSON()` → `{ type: 'error' }` event | **Yes** — stream continues | `openai-compatible-chat-language-model.ts:417-420` |

**Key insight**: The Vercel AI SDK already handles this gracefully — it emits an error event and continues. The problem is that consumers (this agent and upstream OpenCode) throw on that error event instead of handling it.

OpenAI Codex is the gold standard: skip the corrupted event, log a warning, and keep processing the stream.

## Root Cause Summary

| Layer | Responsible Party | Issue |
|-------|------------------|-------|
| SSE Stream | OpenCode Zen gateway / Moonshot Kimi K2.5 | Corrupted SSE chunks (concatenated without delimiters) |
| SSE Parsing | Vercel AI SDK | Handles correctly — emits error event, stream continues |
| **Error Handling** | **Agent `processor.ts`** | **Throws on all error events — should skip parse errors** |
| Error Classification | Agent `message-v2.ts` | Falls to `NamedError.Unknown` (not retryable) — moot if we skip |
| Process Management | Solve script | Misclassifies "Tool execution aborted" as `UsageLimit` |

## Solution: Skip-and-Continue (Codex Approach)

Instead of throwing on stream parse errors, log a warning and continue processing:

```typescript
// In processor.ts, case 'error':
case 'error':
  // Check if this is a stream parse error (malformed SSE from gateway)
  // These are recoverable — the AI SDK continues the stream after emitting this event
  // Skip and continue, like OpenAI Codex does
  if (JSONParseError.isInstance(value.error)) {
    log.warn(() => ({
      message: 'skipping malformed SSE event (stream parse error)',
      errorName: value.error?.name,
      errorMessage: value.error?.message?.substring(0, 200),
    }));
    continue;
  }
  throw value.error;
```

This approach:
- **Does NOT retry** — the error is not retryable, it's skippable
- **Does NOT terminate** — the stream continues processing valid chunks
- **Logs a warning** — visibility into corrupted events for monitoring
- **Matches Codex pattern** — proven approach in production

## Upstream Issues

### 1. OpenCode Zen / Moonshot Kimi K2.5

**Root cause**: The SSE stream produces corrupted chunks where event boundaries are not properly delimited. This appears to happen at the gateway level (OpenCode Zen at `opencode.ai/zen/v1`) when proxying Kimi K2.5 responses.

### 2. Vercel AI SDK (`vercel/ai`)

**Enhancement request**: While the SDK correctly handles parse errors in the stream transform (enqueues error event, continues), it would be beneficial to:
- Add `isRetryable` property to `AI_JSONParseError`
- Provide a configurable `onStreamParseError` callback in provider settings
- Document the recommended pattern for handling `{ type: 'error' }` events in `fullStream`

### 3. OpenCode (sst/opencode — upstream)

**Same gap**: The upstream OpenCode project has the same `case 'error': throw value.error;` pattern in its `processor.ts`, causing identical session termination on stream parse errors.

## Conclusion

The premature session termination was caused by a chain of failures:
1. **Origin**: Kimi K2.5 or OpenCode Zen gateway produced corrupted SSE chunks
2. **SDK**: Vercel AI SDK correctly handled it — emitted error event, continued stream
3. **Agent**: Threw on the error event, terminating the session
4. **Process**: Solve script misclassified the downstream effect

The fix is to adopt the OpenAI Codex approach: **skip corrupted SSE events and continue processing the stream**. A single bad chunk should never terminate an entire session.
