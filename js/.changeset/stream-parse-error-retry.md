---
'@link-assistant/agent': patch
---

fix: Retry on stream parse errors (AI_JSONParseError)

Add StreamParseError as a retryable error type to handle AI_JSONParseError from the
Vercel AI SDK. This error occurs when AI gateways (e.g. Kilo AI Gateway) corrupt SSE
stream chunks when proxying provider responses (e.g. Kimi K2.5, GLM-4.7). The AI SDK's
AI_JSONParseError has no isRetryable property and is never retried by the SDK's built-in
retry mechanism.

- Detect AI_JSONParseError, JSON parsing failures, and malformed JSON errors
- Retry stream parse errors with exponential backoff (1s, 2s, 4s up to 3 retries)
- Add streamParseErrorDelay() function for consistent retry timing
- Add comprehensive test coverage for StreamParseError detection
- Add case study with comparison of 4 CLI agents (Codex, Gemini, Qwen, OpenCode)
- Filed upstream issues: vercel/ai#12595, Kilo-Org/kilocode#5875, anomalyco/opencode#13579

Fixes #169
