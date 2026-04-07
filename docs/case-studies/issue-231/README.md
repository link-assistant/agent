# Case Study: Issue #231 — Silent Model Fallback and Missing Compaction Logs

## Summary

Analysis of execution log from a run where the user requested `kimi-k2.5-free` model but the agent silently used `minimax-m2.5-free` instead. Additionally, HTTP responses for compaction/summarization were not logged.

## Timeline of Events

| Time (UTC) | Event |
|------------|-------|
| 12:32:19 | Outer solver starts with `--model kimi-k2.5-free` |
| 12:33:05 | Agent launched with `--model opencode/kimi-k2.5-free` |
| 12:33:06 | Agent resolves model as `minimax-m2.5-free` (WRONG — silent substitution) |
| 12:33:06 | Storage migration failure logged as error (swallowed) |
| 12:33:06 | `[verbose] HTTP logging active for provider: opencode` written to stderr |
| 12:33:06 | Compaction model set to `gpt-5-nano` |
| 12:33:06–12:37:08 | Agent operates using `minimax-m2.5-free` (~4 minutes) |
| 12:33:44 | 500 error from OpenCode `/responses` endpoint (`input_tokens` undefined) |
| 12:33:52 | Second 500 error from OpenCode `/responses` endpoint |
| 12:37:08 | Last compaction request sent — no response received (process exits) |
| 12:37:09 | Outer solver reports false error detection from verbose log message |

## Root Causes

### Problem 1: Silent Model Substitution (CRITICAL)

**What happened:** User requested `kimi-k2.5-free`, which was expanded to `opencode/kimi-k2.5-free` by the outer solver. The agent's model validation in `model-config.js:78-88` found the model doesn't exist in the opencode provider but only **warned** with the message "model not found in provider — will attempt anyway." Then `provider.ts:1625-1654` created a **fallback minimal model info** for the missing model. The OpenCode API then silently routed the request to `minimax-m2.5-free` (the default model).

**Root cause:** Two layers of permissive fallback:
1. `model-config.js:78-88` — warns instead of failing when explicit `provider/model` has unknown model
2. `provider.ts:1625-1654` — creates synthetic model info for unknown models, allowing SDK calls to proceed

**Fix:** When a user explicitly specifies `provider/model` format and the model is not found in the provider catalog (even after cache refresh), throw an error immediately instead of warning and proceeding.

### Problem 2: Missing HTTP Response for Last Compaction Request

**What happened:** The last compaction POST to `/responses` at 12:37:08.713Z was sent 21ms before the agent exited at 12:37:08.734Z. The streaming response logging runs asynchronously (`verbose-fetch.ts:200-229`), and the process terminated before the response could be received/logged.

**Root cause:** The async stream logging in `verbose-fetch.ts` runs as a fire-and-forget IIFE (`(async () => { ... })()`). There's no mechanism to wait for pending log operations before process exit.

**Fix:** This is a systemic issue — the compaction itself may have been interrupted by process exit. The fix should ensure the process doesn't exit while compaction is in progress. For logging specifically, we can track pending log operations and warn at exit if any are incomplete.

### Problem 3: Verbose Log Message Misinterpreted as Error

**What happened:** `provider.ts:1252-1254` writes `[verbose] HTTP logging active for provider: opencode` to stderr. The outer solver (Hive Mind) scans stderr for error-like patterns and flagged this as an error, setting `errorDetectedInOutput: true` even though the agent exited with code 0.

**Root cause:** The outer solver's (Hive Mind) error detection is too broad — it matches diagnostic messages on stderr as errors.

**Fix:** This is a Hive Mind issue, not an Agent issue. The `[verbose]` prefix is the correct convention for this codebase. Reported to Hive Mind for fix in their error detection logic.

### Problem 4: OpenCode API 500 Errors — No Retry

**What happened:** Two 500 Internal Server Errors from the OpenCode `/responses` endpoint for `gpt-5-nano` compaction at 12:33:44 and 12:33:52 UTC. Error: `Cannot read properties of undefined (reading 'input_tokens')`. The compaction results were lost because the agent had no retry logic for server errors.

**Root cause analysis:** The error `Cannot read properties of undefined (reading 'input_tokens')` is misleading — it is NOT an error in our code's data processing. The actual chain of events:
1. OpenCode API returned an HTTP 500 error response (server-side bug, reported to https://github.com/link-assistant/hive-mind/issues/1537)
2. `retry-fetch.ts` did not retry 500 errors — it only retried 429 (rate limits), so the 500 response was passed through to the AI SDK
3. The AI SDK attempted to parse the 500 error response body as a normal completion response
4. The error response body lacked the `usage` object, causing the TypeError when the SDK accessed `usage.input_tokens`

**Root cause (agent-side):** The `retry-fetch.ts` wrapper only retried HTTP 429 (rate limit) responses. Server errors (500, 502, 503) were passed through without retry, causing intermittent API failures to silently lose compaction results. The `auth/plugins.ts` also only considered 429 and 503 as retryable, missing 500 and 502.

**Fix:**
1. `retry-fetch.ts`: Added retry logic for HTTP 500, 502, 503 with exponential backoff (2s, 4s, 8s) and a maximum of 3 retries. Unlike rate limit retries which can continue indefinitely within the global timeout, server error retries are capped to avoid retrying permanently broken endpoints. When retries are exhausted, the server error response body is logged for diagnostics, preventing misleading downstream errors.
2. `auth/plugins.ts`: Added 500 and 502 to the retryable status set alongside existing 429 and 503.

### Problem 5: Storage Migration Failure Silently Swallowed

**What happened:** `storage.ts:183-184` catches migration errors and only logs them, then continues execution. The migration counter is incremented even on failure.

**Root cause:** `.catch(() => log.error(...))` swallows the error. The actual error details (message, stack) are not logged, making diagnosis impossible.

**Fix:** Log the actual error details. Consider whether migration failures should be fatal or at least include the error message.

## Affected Files

- `js/src/cli/model-config.js` — Model validation (Problem 1)
- `js/src/provider/provider.ts` — Model resolution fallback (Problem 1), verbose stderr (Problem 3)
- `js/src/provider/retry-fetch.ts` — Server error retry logic (Problem 4)
- `js/src/auth/plugins.ts` — Retryable status codes (Problem 4)
- `js/src/util/verbose-fetch.ts` — Async response logging (Problem 2)
- `js/src/storage/storage.ts` — Migration error handling (Problem 5)

## References

- Execution log: [external link](https://github.com/konard/log-tmp-solution-draft-log-pr-1775565431104.txt/raw/main/tmp-solution-draft-log-pr-1775565431104.txt) (55,320 lines)
- Issue: https://github.com/link-assistant/agent/issues/231
- OpenCode API 500 error report: https://github.com/link-assistant/hive-mind/issues/1537
