---
'@link-assistant/agent': patch
---

Add automatic retry for timeout errors with 30s, 60s, 120s intervals

Previously, when an API request timed out (DOMException TimeoutError from AbortSignal.timeout()),
the agent would fail immediately. Now, timeout errors are automatically retried up to 3 times
with increasing delays of 30, 60, and 120 seconds.

This handles all retryable HTTP statuses (408, 409, 429, 500+) via existing APIError retry logic,
plus the new TimeoutError for connection-level timeouts.
