# Feature Request: Make AI_JSONParseError Retryable for Streaming

## Description

When using `streamText` with providers that return malformed SSE responses (e.g., OpenRouter proxying to Kimi K2.5), the AI SDK throws `AI_JSONParseError` which is marked as `isRetryable: false`. However, these errors are typically transient and caused by:

1. SSE chunks being concatenated incorrectly at proxy level
2. Network issues corrupting stream data
3. Provider returning invalid JSON temporarily

These errors should be retryable because they're transient infrastructure issues, not permanent failures.

## Evidence from Production

We observed this error pattern in production logs:

```json
{
  "name": "AI_JSONParseError",
  "cause": {},
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",...}"
}
```

Notice the corrupted data: `"chatcmpl-jQugNdata:{"` - two SSE chunks concatenated together without proper parsing.

The error currently has `isRetryable: false`, which prevents retry logic from working:

```json
{
  "isRetryable": false,
  "name": "AI_APICallError",
  ...
}
```

## Proposed Solution

Mark `AI_JSONParseError` as retryable when it occurs during stream consumption:

```typescript
// Current behavior
throw new JSONParseError({ text, cause, isRetryable: false });

// Proposed behavior for streaming errors
throw new JSONParseError({ text, cause, isRetryable: true });
```

Alternatively, add a configuration option:

```typescript
const result = await streamText({
  model: myModel,
  retryParseErrors: true, // New option
  // ...
});
```

## Environment

- AI SDK Version: Multiple (observed in v4.x and v5.x)
- Providers: OpenRouter (proxying to various models)
- Runtime: Bun 1.3.x

## Workaround

We implemented a workaround in our project by detecting JSONParseError in our error handling and treating it as retryable:

```typescript
const isStreamParseError =
  e.name === 'AI_JSONParseError' ||
  message.includes('AI_JSONParseError') ||
  message.includes('JSON parsing failed') ||
  message.includes('JSON Parse error');

if (isStreamParseError) {
  // Retry with exponential backoff
}
```

See: https://github.com/link-assistant/agent/issues/169

## Related Issues

- #8577 - AI_JSONParseError with generateText (mentions isRetryable: false)
- #4099 - StreamText error handling
- #5417 (ollama/ollama) - Cloudflare Tunnel causing JSONParseError
