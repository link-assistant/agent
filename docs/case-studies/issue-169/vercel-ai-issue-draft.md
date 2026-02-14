# Feature Request: `AI_JSONParseError` should support retry for mid-stream parse errors

## Description

When using `streamText` with OpenAI-compatible providers (via `@ai-sdk/openai-compatible`), the AI SDK may throw `AI_JSONParseError` during stream consumption when a provider or gateway returns malformed SSE data. Currently, this error:

1. Has **no `isRetryable` property** (only `APICallError` has it)
2. Is **never retried** by the SDK's built-in `retryWithExponentialBackoff` mechanism
3. Occurs **after** the HTTP request succeeds (HTTP 200), so the request-level retry is already bypassed

These errors are typically **transient** — caused by:
- SSE chunks being concatenated incorrectly at proxy/gateway level
- Network issues corrupting stream data mid-flight
- Provider temporarily returning invalid JSON in stream

## Evidence from Production

We observed this error when using Kimi K2.5 via the Kilo AI Gateway (`api.kilo.ai`):

```json
{
  "name": "AI_JSONParseError",
  "cause": {},
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",\"object\":\"chat.completion.chunk\",...}"
}
```

The `data:` SSE prefix of the second event was embedded inside the first event's JSON, indicating SSE chunking corruption at the gateway level.

This is a known class of issue — similar reports:
- [ollama/ollama#5417](https://github.com/ollama/ollama/issues/5417): Cloudflare Tunnel + Vercel AI SDK = AI_JSONParseError
- [anomalyco/opencode#7692](https://github.com/anomalyco/opencode/issues/7692): Stream chunks concatenated incorrectly with GLM-4.7
- [vercel/ai#4099](https://github.com/vercel/ai/issues/4099): streamText error handling

## Current Behavior

The AI SDK's parsing pipeline (`parseJsonEventStream`) uses `safeParseJSON` which returns `{ success: false, error: JSONParseError }` on parse failure. The OpenAI-compatible model handler then emits this as `{ type: 'error', error: ... }` in the stream. The default `onError` handler logs to console. The stream continues but the `finishReason` is set to `'error'`.

There is no way for consumers to:
- Retry the stream automatically on parse errors
- Skip bad events and continue processing (like OpenAI Codex does)
- Distinguish transient parse errors from permanent ones

## How Other CLI Agents Handle This

**OpenAI Codex CLI**: Skips unparseable SSE events with `continue;` and keeps processing. JSON parse errors are logged at debug level. Stream-level errors trigger up to 5 retries with exponential backoff. `CodexErr::Json` is explicitly marked retryable.

**Qwen Code**: SDK's `parseJsonLineSafe()` silently skips failed lines with a warning log.

**Gemini CLI** and **OpenCode**: Same gap — JSON parse errors during SSE consumption are not caught/retried.

## Proposed Solutions

### Option A: Add `isRetryable` property to `AI_JSONParseError`

```typescript
// In JSONParseError constructor, or a subclass for stream context
class StreamJSONParseError extends JSONParseError {
  readonly isRetryable = true;
}
```

This would allow consumers to check `isRetryable` consistently across all error types.

### Option B: Add `onStreamParseError` callback to `streamText`

```typescript
const result = await streamText({
  model: myModel,
  onStreamParseError: ({ error, skip }) => {
    // Option to skip the bad event and continue
    skip();
  },
});
```

### Option C: Allow configuring stream-level retry

```typescript
const result = await streamText({
  model: myModel,
  streamRetries: 3, // Retry entire stream on mid-stream errors
});
```

## Environment

- AI SDK Version: Observed across v4.x and v5.x
- Provider: `@ai-sdk/openai-compatible` (Kilo AI Gateway)
- Model: Kimi K2.5 (moonshot/kimi-k2.5:free)
- Runtime: Bun 1.3.x
- Timestamp: 2026-02-14T08:34:12Z

## Workaround

We implemented a workaround by detecting `AI_JSONParseError` in our error handler and classifying it as retryable:

```typescript
const isStreamParseError =
  e.name === 'AI_JSONParseError' ||
  message.includes('AI_JSONParseError') ||
  message.includes('JSON parsing failed');

if (isStreamParseError) {
  // Classify as retryable, retry with exponential backoff
}
```

See: https://github.com/link-assistant/agent/issues/169
