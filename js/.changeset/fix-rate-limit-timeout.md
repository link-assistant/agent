---
'@link-assistant/agent': patch
---

Fix rate limit wait being aborted by provider timeout (#183)

When a rate limit (429) response includes a long retry-after header (e.g., 15 hours),
the agent would fail with "The operation timed out." after only 5 minutes. This occurred
because the rate limit wait shared the same AbortSignal as the provider timeout.

Solution: Use isolated AbortController for rate limit waits that only respects the global
AGENT_RETRY_TIMEOUT (default 7 days), not provider-level timeouts.

Key changes:

- Added createIsolatedRateLimitSignal() for rate limit waits
- Rate limit waits now periodically check for user cancellation (every 10s)
- Proper cleanup of event listeners and timers to prevent memory leaks
- Added comprehensive timeout hierarchy documentation
