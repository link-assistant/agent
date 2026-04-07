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

**What happened:** `provider.ts:1252-1254` writes `[verbose] HTTP logging active for provider: opencode` to stderr. The outer solver scans stderr for error-like patterns and flagged this as an error, setting `errorDetectedInOutput: true` even though the agent exited with code 0.

**Root cause:** Writing diagnostic messages to stderr. While stderr is commonly used for diagnostic output, the outer solver's error detection is too broad.

**Fix:** Change the stderr message format to avoid triggering error detection. Prefix with a clearly non-error marker.

### Problem 4: OpenCode API 500 Errors (External)

**What happened:** Two 500 Internal Server Errors from the OpenCode `/responses` endpoint for `gpt-5-nano` compaction. Error: `Cannot read properties of undefined (reading 'input_tokens')`.

**Root cause:** Server-side bug in OpenCode API's usage tracking where `input_tokens` is undefined. This is external to this codebase.

**Action:** Report to https://github.com/link-assistant/hive-mind/issues

### Problem 5: Storage Migration Failure Silently Swallowed

**What happened:** `storage.ts:183-184` catches migration errors and only logs them, then continues execution. The migration counter is incremented even on failure.

**Root cause:** `.catch(() => log.error(...))` swallows the error. The actual error details (message, stack) are not logged, making diagnosis impossible.

**Fix:** Log the actual error details. Consider whether migration failures should be fatal or at least include the error message.

## Affected Files

- `js/src/cli/model-config.js` — Model validation (Problem 1)
- `js/src/provider/provider.ts` — Model resolution fallback (Problem 1), verbose stderr (Problem 3)
- `js/src/util/verbose-fetch.ts` — Async response logging (Problem 2)
- `js/src/storage/storage.ts` — Migration error handling (Problem 5)

## References

- Execution log: `./execution-log.txt` (55,320 lines)
- Issue: https://github.com/link-assistant/agent/issues/231
