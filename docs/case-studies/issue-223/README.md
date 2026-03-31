# Case Study: Agent CLI Execution Failed (Issue #223)

## Summary

On 2026-03-31, the `@link-assistant/agent` CLI tool failed while solving GitHub issue [bpmbpm/bpm-tensor#1](https://github.com/bpmbpm/bpm-tensor/issues/1). The agent was configured to use `minimax-m2.5-free` via the `opencode` provider, with `gpt-5-nano` as the compaction model (`--compaction-model`). The execution failed after ~32 minutes due to a combination of **MiniMax free-tier rate limiting** and **upstream API connection failures**.

**Key question from the issue:** "Why same model was selected if not requested?"  
**Answer:** The summarization system used the same model as `--model` by design (since [issue #217](https://github.com/link-assistant/agent/issues/217)). However, `gpt-5-nano` was configured as the compaction model and was available for use. The summarization system did not try `gpt-5-nano` — it only used the main model (`minimax-m2.5-free`), doubling rate-limit pressure.

**Was `gpt-5-nano` rate-limited?** No. The logs show zero rate limit events on `gpt-5-nano`. All 25 rate limit events occurred on `minimax-m2.5-free`. The compaction model was used only for compaction overflow checks, never for summarization.

## Full Sequence of Events

| Time (UTC)       | Event                                                        |
|------------------|--------------------------------------------------------------|
| 06:41:13         | Agent starts: `solve v1.40.2`, model: `opencode/minimax-m2.5-free` |
| 06:41:19         | System checks pass (disk, memory)                            |
| 06:41:22 - 06:41:45 | Fork created, branch `issue-1-ae4e40cf019b`, PR #2 created |
| 06:41:51         | Agent session begins, compaction model set to `gpt-5-nano`   |
| 06:41:52         | **First rate limit (429)** on main model call. `retry-after: 62288s` (~17.3h) |
| 06:41:52         | Summarization model selected: `minimax-m2.5-free` (same as `--model`) — `gpt-5-nano` NOT tried |
| 06:41:52 - 06:42:38 | **16 rate limit events** on `minimax-m2.5-free`, all attempt 1. Despite this, 15 successful step-finish events occur (model responses with tool calls). The agent reads the issue, explores the repo, creates a todo list. |
| 06:42:38 - 06:43:45 | Rate limits continue. Agent makes partial progress. |
| 06:45:50 - 07:04:48 | **8 Cloudflare 524 timeout errors** from `api.minimax.io`. Exponential backoff retries. No useful work done. |
| 06:50:24         | First "socket connection closed unexpectedly" error          |
| 07:11:22 - 07:12:25 | Brief recovery: **9 more rate limits**, 9 step-finish events |
| 07:13:54         | Agent exits after step 25. "exiting loop" + "cancel"         |
| 07:13:55         | **Final error:** "The socket connection was closed unexpectedly" |
| 07:13:55         | Agent reported error, exit code 0, `errorDetectedInOutput: true` |

**Total duration:** ~32 minutes (1,923 seconds)  
**Total rate limit events:** 25 (all on `minimax-m2.5-free`, zero on `gpt-5-nano`)  
**Total successful model steps:** ~25  
**Work accomplished:** Read issue, explored repo, created plan — but **no code was written or committed**

## Root Cause Analysis

### Root Cause 1: Summarization Used Main Model Instead of Compaction Model

The summarization system used the same model as `--model` (`minimax-m2.5-free`) instead of the available compaction model (`gpt-5-nano`). This doubled the request rate on the rate-limited free-tier model.

**Evidence from logs:**
```
"hint": "Using same model as --model (not a small model)"    # Every summarization call
"compactionModelID": "gpt-5-nano"                             # Available but unused for summarization
```

The compaction model (`gpt-5-nano`) was configured and loaded by the system for overflow checks, but the summarization code path did not have access to it — it only knew about the assistant message's `providerID` and `modelID`.

### Root Cause 2: MiniMax Free-Tier Daily Quota Exhaustion

The `minimax-m2.5-free` model has a daily quota of **1,000 requests/day** with **100 RPM** ([MiniMax Rate Limits](https://platform.minimax.io/docs/guides/rate-limits)). The `retry-after` header values (~62,288 seconds = ~17.3 hours) indicate a **daily quota reset**, not a per-minute rate limit.

**Evidence:**
```
"retryAfterMs": 62288000    # ~17.3 hours (daily reset)
"retryAfterMs": 62285000    # 3 seconds later, still ~17.3h
"retryAfterMs": 62175000    # 2 minutes later, ~17.27h (countdown consistent)
```

The decreasing values confirm a fixed daily quota reset time.

### Root Cause 3: Upstream API Instability (Cloudflare 524)

After the initial rate limit storm, the agent began receiving **Cloudflare 524 "A timeout occurred"** errors from `api.minimax.io`. The 8 retry attempts with exponential backoff (06:45:50 - 07:04:48) consumed ~19 minutes with zero useful work.

### Root Cause 4: Socket Connection Closure

The final failure was `"The socket connection was closed unexpectedly"`. This is a known issue with Bun's fetch() implementation (see [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439)), likely triggered by the MiniMax API dropping the connection after sustained rate limiting.

## Fix Applied

### Summarization Uses Compaction Model First

Changed `session/summary.ts` to use the compaction model (e.g., `gpt-5-nano` set via `--compaction-model`) for summarization tasks instead of the main model. The fallback chain is:

1. **Try compaction model** (`--compaction-model`, e.g. `gpt-5-nano`) — if configured and not `useSameModel`
2. **Fall back to main model** — if compaction model is not configured or unavailable
3. **Wait and retry** — if both are rate-limited, the existing retry mechanism will wait for limits to reset (respecting `AGENT_RETRY_TIMEOUT` of 7 days)

This ensures:
- Summarization does not consume the main model's rate-limit quota
- The agent does not stop when rate-limited — it waits for limits to reset
- The full `retry-after` value from the server is respected (no artificial capping)

### Key Code Change

```typescript
// summary.ts — before (issue #217)
const model = await Provider.getModel(
  assistantMsg.providerID,
  assistantMsg.modelID  // same as --model, doubles rate-limit pressure
);

// summary.ts — after (issue #223)
const compactionModel = userMsg.compactionModel;
let model = null;
if (compactionModel && !compactionModel.useSameModel) {
  model = await Provider.getModel(
    compactionModel.providerID,
    compactionModel.modelID  // e.g. gpt-5-nano — different rate-limit pool
  );
}
if (!model) {
  model = await Provider.getModel(
    assistantMsg.providerID,
    assistantMsg.modelID  // fallback to main model
  );
}
```

## Impact

1. **No useful output:** Despite running for 32 minutes, no code was written or committed to PR #2
2. **Wasted compute resources:** 25 successful model steps were completed but led to no tangible result
3. **Silent degradation:** The system appeared to make progress (tool calls were executing) but was cycling between rate limits and partial responses

## Key Files

| File | Relevance |
|------|-----------|
| `js/src/session/summary.ts` | Summarization model selection — now uses compaction model first |
| `js/src/provider/retry-fetch.ts` | Rate limit retry logic with 168h global timeout |
| `js/src/session/prompt.ts:546-554` | Compaction model selection (separate from summarization) |
| `js/src/session/compaction.ts:43-48` | CompactionModelConfig interface |
| `js/src/provider/provider.ts:1709-1761` | `getSmallModel()` - existing cheap model fallback |

## References

- **Issue:** [link-assistant/agent#223](https://github.com/link-assistant/agent/issues/223)
- **Failed PR:** [bpmbpm/bpm-tensor#2](https://github.com/bpmbpm/bpm-tensor/pull/2)
- **Full log (gist):** [solution-draft-log-pr-1774941236637.txt](https://gist.githubusercontent.com/konard/7c270eb491745dc3d03e8a9b275154a2/raw/fbb2029c5896008dc7cb55046aa890ca048048a1/solution-draft-log-pr-1774941236637.txt)
- **Summarization model change:** [link-assistant/agent#217](https://github.com/link-assistant/agent/issues/217)
- **Rate limit retry improvements:** [link-assistant/agent#167](https://github.com/link-assistant/agent/issues/167), [#183](https://github.com/link-assistant/agent/issues/183)
- **Bun socket timeout issue:** [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439)
- **MiniMax rate limits docs:** [platform.minimax.io/docs/guides/rate-limits](https://platform.minimax.io/docs/guides/rate-limits)
