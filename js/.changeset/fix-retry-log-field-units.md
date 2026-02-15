---
'@link-assistant/agent': patch
---

Add unit suffixes to all time-related log fields for clarity

Standardized all time-related log fields in retry-fetch.ts and session/retry.ts
to include the Ms (milliseconds) suffix, making logs crystal clear and eliminating
confusion about time units.

Changes:

- retry-fetch.ts: Renamed delay→delayMs, elapsed→elapsedMs, remainingTimeout→remainingTimeoutMs,
  minInterval→minIntervalMs, maxRetryTimeout→maxRetryTimeoutMs, backoffDelay→backoffDelayMs,
  maxBackoffDelay→maxBackoffDelayMs
- session/retry.ts: Renamed elapsedTime→elapsedTimeMs, maxTime→maxTimeMs,
  backoffDelay→backoffDelayMs, maxBackoffDelay→maxBackoffDelayMs, maxCap→maxCapMs

This is a logging-only change with no functional impact. All tests pass.

Fixes #181
