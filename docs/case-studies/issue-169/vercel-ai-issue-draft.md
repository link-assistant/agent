# Feature Request: `AI_JSONParseError` — recommend skip-and-continue pattern for consumers

## Description

When using `streamText` with OpenAI-compatible providers (via `@ai-sdk/openai-compatible`), the AI SDK may encounter malformed JSON in SSE data from gateways/proxies. The SDK handles this correctly:

1. `safeParseJSON()` catches the parse failure, returns `{ success: false, error: JSONParseError }`
2. The model handler emits `{ type: 'error', error: chunk.error }` and **returns** — the stream continues
3. The `finishReason` is set to `'error'`

However, the recommended handling pattern for consumers is unclear. Many consumers (including OpenCode/sst and our agent) implement `case 'error': throw value.error;` in their `fullStream` iteration, which terminates the session on a single bad SSE event.

## Evidence from Production

We observed this error when using Kimi K2.5 via OpenCode Zen (`opencode.ai/zen/v1`):

```json
{
  "name": "AI_JSONParseError",
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",\"object\":\"chat.completion.chunk\",...}"
}
```

Two SSE events were concatenated: `data:` prefix of the second event embedded in the first event's JSON.

## How Other CLI Agents Handle This

| Agent | Pattern | Result |
|-------|---------|--------|
| **OpenAI Codex** (Rust) | `debug!("Failed to parse SSE event"); continue;` | Skip & continue |
| **Gemini CLI** | `throw e;` in `@google/genai` SDK | Stream terminates (gap) |
| **OpenCode** (upstream) | `case 'error': throw value.error;` | Session terminates (gap) |

OpenAI Codex is the gold standard: skip corrupted events, log at debug level, keep processing.

## Suggestions

### 1. Document the recommended pattern

Add documentation showing how consumers should handle `{ type: 'error' }` events in `fullStream`:

```typescript
for await (const value of stream.fullStream) {
  if (value.type === 'error') {
    if (JSONParseError.isInstance(value.error)) {
      // Skip corrupted SSE events — the stream continues
      console.warn('Skipping malformed SSE event:', value.error.message);
      continue;
    }
    throw value.error; // Other errors are still fatal
  }
  // ... handle other events
}
```

### 2. Consider adding `isRetryable` to `AI_JSONParseError`

```typescript
class StreamJSONParseError extends JSONParseError {
  readonly isRetryable = true;
}
```

### 3. Consider `onStreamParseError` callback

```typescript
const result = await streamText({
  model: myModel,
  onStreamParseError: ({ error }) => {
    // Log and skip by default
    console.warn('Parse error in SSE stream:', error);
  },
});
```

## Environment

- AI SDK: v6.x (observed across versions)
- Provider: `@ai-sdk/openai-compatible` (OpenCode Zen gateway)
- Model: Kimi K2.5 (`kimi-k2.5-free`)
- Runtime: Bun 1.3.x
- Timestamp: 2026-02-14T08:34:12Z

## Workaround

We detect `JSONParseError` in our `fullStream` iteration and skip it:

```typescript
case 'error':
  if (JSONParseError.isInstance(value.error)) {
    log.warn('skipping malformed SSE event');
    continue;
  }
  throw value.error;
```

See: https://github.com/link-assistant/agent/issues/169
