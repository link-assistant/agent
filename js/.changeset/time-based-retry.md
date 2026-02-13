---
'@link-assistant/agent': patch
---

fix: Time-based retry for rate limits at fetch level

Implement custom fetch wrapper to handle HTTP 429 (rate limit) responses at the HTTP layer,
ensuring the agent's time-based retry configuration is respected instead of the AI SDK's
fixed retry count (3 attempts).

Changes:

- Add RetryFetch wrapper that intercepts 429 responses before AI SDK's internal retry
- Parse retry-after and retry-after-ms headers from server responses
- Use exponential backoff when no header is present (up to 20 minutes per retry)
- Respect AGENT_RETRY_TIMEOUT (default: 7 weeks) as global timeout
- Add AGENT_MIN_RETRY_INTERVAL (default: 30 seconds) to prevent rapid retry attempts
- Retry network errors (socket/connection issues) with exponential backoff
- Compose with existing custom fetch functions (OAuth, timeout wrappers)

This fixes the issue where the AI SDK exhausted its 3 retry attempts before the agent's
retry logic could wait for the server's retry-after period (e.g., 64 minutes).

Fixes #167
