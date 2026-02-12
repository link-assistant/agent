# Case Study: Issue #146 - Agent CLI is stuck, there was no timeout

## Summary

The Agent CLI process became stuck for **2 hours and 10 minutes** with no error message, no timeout, and no recovery mechanism. The process had to be manually terminated with CTRL+C. This case study reconstructs the timeline, identifies root causes, and proposes solutions.

## Issue Reference

- **Issue:** https://github.com/link-assistant/agent/issues/146
- **Reported by:** @konard
- **Date:** 2026-01-30
- **Component:** Agent CLI (`@link-assistant/agent` v0.8.11)
- **Runtime:** Bun
- **AI SDK:** `ai` v6.0.0-beta.99 (Vercel AI SDK)

## Incident Timeline

### Session 1 (Working normally)

| Time (UTC) | Event |
|---|---|
| 15:01:05 | solve.mjs starts (v1.9.0), tool: `agent`, model: `opencode/big-pickle` |
| 15:01:35 | Agent CLI launched. Session `ses_3f0937c16ffe7n0KHrkhDHOw7o` begins |
| 15:02:36 | First step_start. Agent creates todo list (8 items) |
| 15:06:35 | **ERROR: "The operation timed out."** (Timeout #1 - recovered after ~1m19s) |
| 15:07:54 | Agent recovers and continues working |
| 15:21:50 | Session 1 ends normally with `reason: stop` |

### Session 2 (Gets stuck)

| Time (UTC) | Event |
|---|---|
| 15:22:00 | Session 2 begins (`ses_3f080aea6ffeMEjbgsZFV7KCgy`) - auto-restart for uncommitted changes |
| 15:22:11 | First step_start |
| 15:27:08 | **ERROR: "The operation timed out."** (Timeout #2 - recovered after ~15s) |
| 15:37:01.645 | **LAST LOG LINE WITH ACTIVITY** - step_finish with `reason: "tool-calls"` |
| _(silence)_ | **2 hours, 10 minutes, 4 seconds of no activity** |
| 17:47:05.206 | "Keeping directory" message appears |
| 17:47:05.260 | **CTRL+C** - Manual forced termination |

### Key Observations

1. The last `step_finish` had `reason: "tool-calls"`, indicating the model requested more tool calls
2. The next `step_start` **never materialized** - the process was stuck between steps
3. Two previous timeouts ("The operation timed out.") were recoverable, but the final hang had **no timeout error at all**
4. Token usage at last step: input=118, output=89, cache_read=103,658, reasoning=1
5. No error was logged before the 2h10m gap

## Root Cause Analysis

### Primary Root Cause: No `streamText` chunk/step timeout

The `streamText()` call in `js/src/session/prompt.ts:614` does **not** configure any timeout parameter. The Vercel AI SDK v6 supports a `timeout` option with three sub-properties:

- `totalMs` - Total timeout for the entire call
- `stepMs` - Timeout for each individual LLM step
- `chunkMs` - Timeout between stream chunks (detects stalled streams)

None of these are configured. When the upstream API connection stalls (TCP connection stays open but no data flows), the `streamText` call waits indefinitely.

**Evidence:** In `js/src/session/prompt.ts:614-714`, the `streamText()` call includes `abortSignal`, `maxRetries: 0`, `stopWhen: stepCountIs(1)`, etc. but NO `timeout` configuration.

### Contributing Factor: No session-level inactivity timeout

The `SessionPrompt.loop()` function (`js/src/session/prompt.ts:233-728`) runs in a `while(true)` loop. There is no watchdog timer that detects if a step takes too long. If `streamText` hangs, the entire loop hangs.

### Contributing Factor: `messagePromise` in continuous mode has no timeout

In `js/src/cli/continuous-mode.js:264-274` and `487-497`, the `messagePromise` waits for a `session.idle` event with no timeout. If the session never reaches idle state (because `streamText` is stuck), this promise waits forever.

### Contributing Factor: `setInterval` polling not `.unref()`-ed

In `js/src/cli/continuous-mode.js:380` and `597`, `setInterval()` calls that poll `stdinReader.isRunning()` are not `.unref()`-ed. While this doesn't cause the hang directly, it prevents the Node.js event loop from exiting naturally even if all other work is done. Other parts of the codebase (e.g., `provider/models.ts:97`, `project/state.ts:54`) correctly use `.unref()`.

### Related: Previous timeout retry work (PR #143)

PR #143 ("Add automatic retry for timeout errors with configurable intervals") added retry handling for `TimeoutError` (from `AbortSignal.timeout()`). However, this only handles the case where a timeout IS detected. The core issue is that no timeout is SET on the `streamText` call, so the `DOMException` with `name === 'TimeoutError'` is never generated in the first place for stalled-stream scenarios.

## Sequence of Events (Reconstructed)

```
┌─────────────────┐
│  prompt.ts loop  │  while(true) loop in SessionPrompt.loop()
│     step N       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  streamText()   │  No timeout configured
│  (AI SDK v6)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  HTTP/2 stream  │  Connection to LLM API (e.g., Anthropic)
│  to provider    │
└────────┬────────┘
         │
         ▼  ← Stream stalls here (TCP alive, no data)
         │
    ┌────┴────────────────────────────┐
    │  No chunkMs timeout configured  │
    │  No stepMs timeout configured   │
    │  No totalMs timeout configured  │
    │  AbortSignal not timed          │
    │                                 │
    │  Process waits indefinitely...  │
    │  (2 hours 10 minutes)           │
    └─────────────────────────────────┘
         │
         ▼
    CTRL+C (manual intervention)
```

## Proposed Solutions

### Solution 1: Add `timeout` to `streamText()` call (Primary fix)

Add `chunkMs` and `stepMs` timeouts to the `streamText()` call in `js/src/session/prompt.ts`.

```typescript
const result = await processor.process(() =>
  streamText({
    // ... existing options ...
    timeout: {
      chunkMs: 120_000,  // 2 minutes between chunks (detect stalled streams)
      stepMs: 600_000,   // 10 minutes per step
    },
  })
);
```

**Rationale:**
- `chunkMs: 120_000` (2 minutes) matches the existing MCP `BUILTIN_DEFAULT_TOOL_CALL_TIMEOUT`
- `stepMs: 600_000` (10 minutes) matches the existing MCP `BUILTIN_MAX_TOOL_CALL_TIMEOUT`
- These values are generous enough to allow large model responses while catching stalls

**References:**
- [AI SDK `streamText` timeout docs](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK Issue #5438: Promises hang on streamText()](https://github.com/vercel/ai/issues/5438)

### Solution 2: Add `.unref()` to `setInterval` in continuous mode

```javascript
const checkRunning = setInterval(() => {
  // ...
}, 100);
checkRunning.unref(); // Allow process to exit naturally
```

### Solution 3: Add configurable timeout via CLI/environment

Allow users to configure the stream timeout via:
- Environment variable: `AGENT_STREAM_CHUNK_TIMEOUT_MS` (default: 120000)
- Environment variable: `AGENT_STREAM_STEP_TIMEOUT_MS` (default: 600000)

## Existing Libraries & Components

| Library/Component | Relevance |
|---|---|
| [Vercel AI SDK `timeout` option](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) | Built-in solution - `chunkMs`, `stepMs`, `totalMs` |
| [AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static) | Standard Web API for timeout-based abort signals |
| Agent's own `withTimeout()` utility (`js/src/util/timeout.ts`) | Already used for MCP tool timeouts |
| Agent's `SessionRetry` (`js/src/session/retry.ts`) | Already handles API and socket error retries |

## Impact Assessment

- **Severity:** High - Process hangs indefinitely, wastes compute and API resources
- **Frequency:** Intermittent - Depends on network conditions and provider reliability
- **Affected users:** All users running the agent CLI in continuous or direct mode
- **Workaround:** Manual CTRL+C termination and restart

## Files Referenced

- `js/src/session/prompt.ts:614-714` - `streamText()` call (missing timeout)
- `js/src/session/processor.ts:41-395` - Stream processing loop
- `js/src/cli/continuous-mode.js:264-274, 380, 487-497, 597` - Message promise and interval polling
- `js/src/util/timeout.ts` - Existing timeout utility
- `js/src/session/retry.ts` - Existing retry logic
- `js/src/mcp/index.ts:17-26` - MCP timeout defaults (reference values)

## Logs

- `logs/solve-full.log` - Complete session log showing the 2h10m hang
- `logs/solution-draft-failed.log` - Failed solution draft attempt (separate issue: invalid Unicode surrogate in API request)
