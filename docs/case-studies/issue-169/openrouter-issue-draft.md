# Bug Report: Malformed SSE Response from Kimi K2.5 Streaming

## Description

When streaming responses from `moonshotai/kimi-k2.5-free` via OpenRouter, we occasionally receive malformed SSE data where two chunks appear to be concatenated together, causing JSON parsing to fail.

## Evidence

We observed this in our production logs:

```json
{
  "text": "{\"id\":\"chatcmpl-jQugNdata:{\"id\":\"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO\",\"object\":\"chat.completion.chunk\",\"created\":1771058051,\"model\":\"kimi-k2.5\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}],\"system_fingerprint\":\"fpv0_f7e5c49a\"}"
}
```

Notice the malformed data: `"chatcmpl-jQugNdata:{"`

This appears to be partial text from one SSE event (`chatcmpl-jQugN`) concatenated with `data:` and the next event (`{"id":"chatcmpl-iU6vk...`).

## Expected Format

Correct SSE format should be:

```
data: {"id":"chatcmpl-jQugN",...}

data: {"id":"chatcmpl-iU6vk",...}
```

## Environment

- Model: `moonshotai/kimi-k2.5-free`
- Client: Vercel AI SDK with custom fetch wrapper
- Runtime: Bun 1.3.x
- Timestamp: 2026-02-14T08:34:12Z

## Impact

This causes `AI_JSONParseError` which terminates the stream processing. The error is transient and typically recovers on retry.

## Possibly Related

- The issue may be related to how OpenRouter proxies streams from Moonshot's backend
- Could be related to the free tier having different infrastructure

## Workaround

We implemented retry logic for stream parse errors in our application:
https://github.com/link-assistant/agent/issues/169
