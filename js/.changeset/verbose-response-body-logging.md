---
'@link-assistant/agent': patch
---

feat: log HTTP response body in verbose mode for debugging provider failures (#204)

When `--verbose` is enabled, the raw HTTP response body from LLM providers is now
also logged. For streaming (SSE) responses, the stream is tee'd so the AI SDK receives
the full response while a preview (up to 4000 chars) is logged asynchronously. For
non-streaming responses, the body is buffered, logged, and the Response is reconstructed
transparently.

This provides the missing visibility needed to diagnose issues like empty responses,
malformed SSE events, or error messages from providers like opencode/kimi-k2.5-free.
