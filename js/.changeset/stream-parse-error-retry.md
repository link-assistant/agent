---
'@link-assistant/agent': patch
---

fix: Retry on stream parse errors (AI_JSONParseError)

Add StreamParseError as a retryable error type to handle malformed JSON in SSE streams
from AI providers. This fixes premature retry failures when providers return corrupted
streaming responses (e.g., concatenated SSE chunks, invalid JSON).

- Detect AI_JSONParseError, JSON parsing failures, and malformed JSON errors
- Retry stream parse errors with exponential backoff (1s, 2s, 4s up to 3 retries)
- Add streamParseErrorDelay() function for consistent retry timing
- Add comprehensive test coverage for StreamParseError detection

Fixes #169
