# Case Study: Premature Session Termination Due to SSE Stream Corruption (Issue #169)

## Summary

The agent's session terminated after ~5 minutes instead of retrying for the expected 7-day window. The root cause is a chain of three failures:

1. **SSE stream corruption** at the Kilo AI Gateway level when proxying responses from Moonshot's Kimi K2.5 API
2. **Vercel AI SDK** throwing `AI_JSONParseError` (which has no `isRetryable` property and no built-in retry for mid-stream errors)
3. **Agent's error classifier** in `message-v2.ts` falling through to `NamedError.Unknown`, which is not retryable

## Infrastructure Chain

```
Agent (Bun) → OpenCode Zen Provider → Kilo AI Gateway (api.kilo.ai) → Moonshot Kimi K2.5 API
```

- **Provider ID**: `opencode` (resolved from `--model kimi-k2.5-free`)
- **SDK**: `@ai-sdk/openai-compatible` (OpenAI-compatible protocol)
- **Gateway**: Kilo AI Gateway at `https://api.kilo.ai/api/gateway`
- **Model**: `moonshot/kimi-k2.5:free` (Moonshot's Kimi K2.5, free tier)

**Note**: OpenRouter is NOT involved in this incident. The previous analysis incorrectly attributed the SSE corruption to OpenRouter. The actual proxy is the Kilo AI Gateway.

## Timeline of Events

| Time (UTC) | Event | Details |
|------------|-------|---------|
| 08:28:31 | Process started | `solve v1.23.1`, model `kimi-k2.5-free` |
| 08:28:51 | Branch created | `issue-761-a0caf45f6eba` |
| 08:28:58 | PR created | PR #778 on target repo |
| 08:29:06 | Session 1 started | `ses_3a4bb6d8dffeiS5FRAjqmkJinT`, providerID=`opencode` |
| 08:29:08 | Rate limit (429) | `retry-after: 55852` seconds (~15.5 hours) |
| 08:29:08–08:30:31 | Multiple 429s | All correctly scheduled with retry-after delays |
| 08:33:41 | Session 2 started | `ses_3a4b73b0effeFXKMNNCv1Lm3b2`, providerID=`opencode` |
| 08:34:12.210 | Stream error | `AI_JSONParseError: JSON parsing failed` |
| 08:34:12.211 | Error classified | `NamedError.Unknown` (not retryable) |
| 08:34:12.213 | Tool aborted | In-flight tool call marked "Tool execution aborted" |
| 08:34:12.293 | Solve script | Misclassified as `UsageLimit` due to "Tool execution aborted" pattern |
| 08:34:12.301 | **Session terminated** | Process exited, total runtime ~5 minutes |

## Root Cause Analysis

### Root Cause 1: Malformed SSE Data from Kilo AI Gateway

The SSE stream returned corrupted data where two SSE chunks were concatenated without proper delimiters:

```
Received (corrupted):
{"id":"chatcmpl-jQugNdata:{"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk","created":1771058051,"model":"kimi-k2.5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"system_fingerprint":"fpv0_f7e5c49a"}
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

This is a known class of issue with AI gateways/proxies. Similar issues have been reported:
- [OpenCode #7692](https://github.com/anomalyco/opencode/issues/7692): "JSON Parse Error with Zhipu GLM-4.7: Stream chunks are concatenated incorrectly"
- [OpenCode #10967](https://github.com/anomalyco/opencode/issues/10967): "Error Writing Large Files (at least with Kimi K2.5)"
- [Kilo-Org/kilocode #5433](https://github.com/Kilo-Org/kilocode/issues/5433): "Kimi K2.5 - Fails with Kilo Gateway"
- [sglang #8613](https://github.com/sgl-project/sglang/issues/8613): "Kimi-K2 model outputs incomplete content during multi-turn streaming"

### Root Cause 2: Vercel AI SDK Does Not Retry Mid-Stream Parse Errors

The Vercel AI SDK's SSE parsing pipeline is:

```
HTTP Response Body (bytes)
  → TextDecoderStream (bytes → text)
  → EventSourceParserStream (eventsource-parser library, text → SSE messages)
  → TransformStream (SSE data → JSON.parse → ParseResult)
  → OpenAI-compatible model handler (ParseResult → stream parts)
```

Key findings from [AI SDK source code analysis](https://github.com/vercel/ai):
- `AI_JSONParseError` has **NO `isRetryable` property** (only `APICallError` has it)
- The SDK's retry mechanism (`retryWithExponentialBackoff`) only retries `APICallError` instances
- Mid-stream errors (after HTTP 200 is received) are **never retried** by the SDK
- The error is emitted as `{ type: 'error', error: JSONParseError }` in the stream
- Default `onError` handler simply `console.error`s it

References:
- [Vercel AI SDK Error Reference](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-json-parse-error)
- [Vercel AI #4099](https://github.com/vercel/ai/issues/4099): streamText error handling
- [Ollama #5417](https://github.com/ollama/ollama/issues/5417): Cloudflare Tunnel + Vercel AI SDK = AI_JSONParseError

### Root Cause 3: Agent's Error Classifier Falls Through to UnknownError

In `message-v2.ts:fromError()`, the error classification chain is:
1. `DOMException AbortError` → `AbortedError` ❌
2. `DOMException TimeoutError` → `TimeoutError` ❌
3. `OutputLengthError` → pass through ❌
4. `LoadAPIKeyError` → `AuthError` ❌
5. `APICallError` → `APIError` ❌
6. `Error` with socket message → `SocketConnectionError` ❌
7. `Error` with timeout message → `TimeoutError` ❌
8. **`AI_JSONParseError` falls through here** → `NamedError.Unknown`

Since `NamedError.Unknown` is not in the retryable error list in `processor.ts`, the session terminates immediately.

### Contributing Factor: Solve Script Error Misclassification

The external solve script detected "Tool execution aborted" (a side effect of the stream error — in-flight tool calls are aborted when the stream errors out) and misclassified it as `UsageLimit`, preventing any further retry at the script level.

## Comparison with Other CLI Agents

### OpenAI Codex CLI (Rust)
**Best practice found**: Codex **skips unparseable SSE events and continues processing the stream**. JSON parse errors on individual events are logged at debug level and the stream loop continues with `continue;`. Only SSE framing errors (protocol-level) terminate the stream, and even those trigger stream-level retries (up to 5 retries with exponential backoff). `CodexErr::Json` is explicitly marked as retryable.

Key code (`codex-api/src/sse/responses.rs:373-379`):
```rust
let event: ResponsesStreamEvent = match serde_json::from_str(&sse.data) {
    Ok(event) => event,
    Err(e) => {
        debug!("Failed to parse SSE event: {e}, data: {}", &sse.data);
        continue;  // Skip and continue processing the stream
    }
};
```

### Gemini CLI
**Two-layer retry architecture**: Layer 1 retries the HTTP connection (exponential backoff, 3 attempts). Layer 2 retries stream consumption errors including `InvalidStreamError` (when stream ends without finish reason, with empty response, or with malformed function call). However, `SyntaxError` from JSON.parse in the custom SSE parser is **NOT caught** — this is a gap similar to the agent's.

### Qwen Code
**Graceful JSON parse recovery in SDK**: The SDK's `parseJsonLineSafe()` function silently skips lines that fail to parse, logging a warning instead of crashing. At the stream level, `StreamContentError` for rate limits is retried with 60-second delays (up to 10 retries). `InvalidStreamError` is retried once with 500ms delay.

### OpenCode (sst/opencode — this project's upstream)
**Same gap as the agent**: `AI_JSONParseError` falls through to `NamedError.Unknown` in `fromError()` and is NOT retried. The `retryable()` function in `retry.ts` returns `undefined` for Unknown errors that don't contain parseable JSON.

## Root Cause Summary

| Layer | Responsible Party | Issue |
|-------|------------------|-------|
| SSE Stream | Kilo AI Gateway / Moonshot Kimi K2.5 | Corrupted SSE chunks (concatenated without delimiters) |
| SSE Parsing | Vercel AI SDK (`eventsource-parser`) | No retry for mid-stream parse errors; `AI_JSONParseError` has no `isRetryable` |
| Error Classification | Agent (`message-v2.ts`) | Falls through to `NamedError.Unknown` (not retryable) |
| Process Management | Solve script | Misclassifies "Tool execution aborted" as `UsageLimit` |

## Proposed Solutions

### Solution 1: Skip-and-Continue (Codex approach) — Recommended for prevention

Instead of terminating the stream on a single bad SSE event, skip the corrupted event and continue processing:

```typescript
// In a custom response handler or transform stream
if (!chunk.success) {
  log.warn('Skipping unparseable SSE event', { error: chunk.error.text });
  return; // Skip this event, continue with next
}
```

This is the most resilient approach — used by OpenAI Codex. A single corrupted SSE chunk should not terminate an entire stream when subsequent chunks may be valid.

### Solution 2: Stream-Level Retry (Current approach, improved)

Detect `AI_JSONParseError` in `fromError()` and classify as `StreamParseError` (retryable). Retry the entire stream with exponential backoff:

```typescript
// In message-v2.ts fromError()
const isStreamParseError =
  e.name === 'AI_JSONParseError' ||
  message.includes('AI_JSONParseError') ||
  message.includes('JSON parsing failed');
if (isStreamParseError) {
  return new MessageV2.StreamParseError(
    { message, isRetryable: true, text: (e as any).text },
    { cause: e }
  ).toObject();
}
```

### Solution 3: Upstream Fixes

File issues with:
1. **Vercel AI SDK**: Request `isRetryable` property on `AI_JSONParseError`, or a configurable stream error handler
2. **Kilo AI Gateway**: Report SSE stream corruption when proxying Kimi K2.5
3. **Moonshot (Kimi K2.5)**: Report SSE stream format issues

## External Issues to File

### 1. Vercel AI SDK (`vercel/ai`)

**Title**: `AI_JSONParseError` should support retry for mid-stream parse errors

**Key points**:
- `AI_JSONParseError` has no `isRetryable` property
- The SDK's built-in retry only works for `APICallError` and only for the initial HTTP request
- Mid-stream parse errors (after HTTP 200) are never retried
- Other CLI agents (OpenAI Codex) handle this by skipping bad events or retrying the stream
- Propose: add `isRetryable` property, or provide a `onStreamParseError` callback, or expose a way to configure stream-level retry

### 2. Kilo AI Gateway (`Kilo-Org`)

**Title**: SSE stream corruption when proxying Kimi K2.5 — chunks concatenated without delimiters

**Key points**:
- Two SSE events concatenated: `{"id":"chatcmpl-jQugNdata:{"id":"chatcmpl-iU6vk...`
- The `data:` prefix of the second event is embedded in the first event's JSON
- This violates the SSE specification (RFC)
- Timestamp: 2026-02-14T08:34:12Z
- Model: `moonshot/kimi-k2.5:free`
- Related: [Kilo-Org/kilocode #5433](https://github.com/Kilo-Org/kilocode/issues/5433)

### 3. Moonshot (moonshotai/Kimi-K2-Instruct)

**Title**: Kimi K2.5 SSE streaming produces malformed chunks

**Key points**:
- SSE chunks appear to be truncated and concatenated at the origin level
- Multiple reports across different gateways (Kilo, OpenCode Zen)
- Related: [sglang #8613](https://github.com/sgl-project/sglang/issues/8613)

## Conclusion

The premature session termination was caused by a cascade of failures across four layers:
1. **Origin**: Kimi K2.5 or Kilo Gateway produced corrupted SSE chunks
2. **SDK**: Vercel AI SDK correctly detected the corruption but provided no retry/recovery path
3. **Agent**: Error classifier didn't recognize `AI_JSONParseError` as retryable
4. **Process**: Solve script misclassified the downstream effect as a usage limit

The best defense is defense in depth:
- **Short-term**: Classify `AI_JSONParseError` as retryable (Solution 2, already implemented)
- **Medium-term**: Implement skip-and-continue for individual bad SSE events (Solution 1, Codex approach)
- **Long-term**: File upstream issues for proper fixes at gateway and SDK level (Solution 3)
