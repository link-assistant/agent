# Bug Report: SSE stream corruption when proxying Kimi K2.5 — chunks concatenated without delimiters

## Description

When streaming responses from `moonshot/kimi-k2.5:free` via the Kilo AI Gateway (`api.kilo.ai`), we occasionally receive malformed SSE data where two SSE events are concatenated without proper `\n\ndata: ` delimiters. This causes downstream JSON parsing to fail.

## Evidence

The raw SSE data received by the client (captured via Vercel AI SDK error):

```json
{
  "name": "AI_JSONParseError",
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",\"object\":\"chat.completion.chunk\",\"created\":1771058051,\"model\":\"kimi-k2.5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}],\"system_fingerprint\":\"fpv0_f7e5c49a\"}"
}
```

### Analysis of corruption

The data shows two SSE events merged into one:

| Part | Content | What it should be |
|------|---------|-------------------|
| Chunk 1 (truncated) | `{"id":"chatcmpl-jQugN` | Complete first SSE event JSON |
| SSE prefix (embedded) | `data:` | Should be on a new line after `\n\n` |
| Chunk 2 (complete) | `{"id":"chatcmpl-iU6vk...}` | Complete second SSE event JSON |

### Expected SSE format

Per the [SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html), each event should be separated by a blank line (`\n\n`):

```
data: {"id":"chatcmpl-jQugN","object":"chat.completion.chunk",...}\n
\n
data: {"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk",...}\n
\n
```

## Environment

- **Gateway**: Kilo AI Gateway (`https://api.kilo.ai/api/gateway`)
- **Model**: `moonshot/kimi-k2.5:free`
- **Client SDK**: Vercel AI SDK (`@ai-sdk/openai-compatible`)
- **SSE Parser**: `eventsource-parser` (used by AI SDK)
- **Runtime**: Bun 1.3.x
- **API Key**: `public` (free tier)
- **Timestamp**: 2026-02-14T08:34:12Z UTC

## Impact

This causes `AI_JSONParseError` which terminates stream processing for the consumer. Since this is a transient infrastructure issue (not a model capability issue), it should not fail the user's request.

## Possibly Related

- [Kilo-Org/kilocode#5433](https://github.com/Kilo-Org/kilocode/issues/5433): Kimi K2.5 - Fails with Kilo Gateway
- [sglang#8613](https://github.com/sgl-project/sglang/issues/8613): Kimi-K2 model outputs incomplete content during multi-turn streaming
- [anomalyco/opencode#7692](https://github.com/anomalyco/opencode/issues/7692): Similar SSE concatenation issue with GLM-4.7
- [anomalyco/opencode#10967](https://github.com/anomalyco/opencode/issues/10967): Error Writing Large Files with Kimi K2.5

## Workaround

We classify `AI_JSONParseError` as retryable in our client and retry the entire stream with exponential backoff (1s, 2s, 4s, up to 3 retries).

See: https://github.com/link-assistant/agent/issues/169
