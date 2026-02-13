---
'@link-assistant/agent': minor
---

Add --generate-title flag and enhanced retry logic with exponential backoff

- Add `--generate-title` CLI option (disabled by default) to save tokens on title generation
- Implement retry with exponential backoff up to 20 minutes per retry, 7 days total timeout
- Add `--retry-timeout` option to configure maximum retry duration (default: 7 days)
- Respect retry-after headers from API responses
- Add jitter to prevent thundering herd on retries
- Track retry state per error type (different errors reset the timer)
