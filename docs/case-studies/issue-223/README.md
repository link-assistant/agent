# Case Study: Agent CLI Execution Failed (Issue #223)

## Summary

On 2026-03-31, the `@link-assistant/agent` CLI tool failed while solving GitHub issue [bpmbpm/bpm-tensor#1](https://github.com/bpmbpm/bpm-tensor/issues/1). The agent was configured to use `minimax-m2.5-free` via the `opencode` provider, with `gpt-5-nano` as the compaction model. The execution failed after ~32 minutes due to a combination of **MiniMax free-tier rate limiting** and **upstream API connection failures**.

**Key question from the issue:** "Why same model was selected if not requested?"  
**Answer:** The summarization system uses the same model as `--model` by design (since [issue #217](https://github.com/link-assistant/agent/issues/217)). This is intentional behavior, not a fallback or error. However, this design decision amplifies rate-limit pressure when using free-tier models with strict quotas.

## Timeline of Events

| Time (UTC)       | Event                                                        |
|------------------|--------------------------------------------------------------|
| 06:41:13         | Agent starts: `solve v1.40.2`, model: `opencode/minimax-m2.5-free` |
| 06:41:19         | System checks pass (disk, memory)                            |
| 06:41:22 - 06:41:45 | Fork created, branch `issue-1-ae4e40cf019b`, PR #2 created |
| 06:41:51         | Agent session begins, compaction model set to `gpt-5-nano`   |
| 06:41:52         | **First rate limit (429)** on main model call. `retry-after: 62288s` (~17.3h) |
| 06:41:52         | Summarization model selected: `minimax-m2.5-free` (same as `--model`) |
| 06:41:52 - 06:42:38 | **16 rate limit events** on main model, all attempt 1. Despite this, 15 successful step-finish events occur (model responses with tool calls). The agent reads the issue, explores the repo, creates a todo list. |
| 06:42:38 - 06:43:45 | Rate limits continue. Agent makes partial progress. |
| 06:45:50 - 07:04:48 | **8 Cloudflare 524 timeout errors** from `api.minimax.io`. Exponential backoff retries. No useful work done. |
| 06:50:24         | First "socket connection closed unexpectedly" error          |
| 07:11:22 - 07:12:25 | Brief recovery: **9 more rate limits**, 9 step-finish events |
| 07:13:54         | Agent exits after step 25. "exiting loop" + "cancel"         |
| 07:13:55         | **Final error:** "The socket connection was closed unexpectedly" |
| 07:13:55         | Agent reported error, exit code 0, `errorDetectedInOutput: true` |

**Total duration:** ~32 minutes (1,923 seconds)  
**Total rate limit events:** 25  
**Total successful model steps:** ~25  
**Work accomplished:** Read issue, explored repo, created plan — but **no code was written or committed**

## Root Cause Analysis

### Root Cause 1: MiniMax Free-Tier Daily Quota Exhaustion

The `minimax-m2.5-free` model is provided via MiniMax's free tier through the `opencode.ai` proxy. The free tier has a daily quota of **1,000 requests/day** with **100 RPM** ([MiniMax Rate Limits](https://platform.minimax.io/docs/guides/rate-limits)). The `retry-after` header values (~62,288 seconds = ~17.3 hours) indicate a **daily quota reset**, not a per-minute rate limit.

The agent hit this quota almost immediately because:
- The main model (`minimax-m2.5-free`) consumes requests for each step
- The **summarization model also uses `minimax-m2.5-free`** (same model by design), doubling the request rate
- The **compaction model (`gpt-5-nano`)** uses OpenAI's API but doesn't contribute to MiniMax rate limits

**Evidence:**
```
"retryAfterMs": 62288000    # ~17.3 hours (daily reset)
"retryAfterMs": 62285000    # 3 seconds later, still ~17.3h
"retryAfterMs": 62175000    # 2 minutes later, ~17.27h (countdown consistent)
```

The decreasing `retryAfterMs` values confirm a fixed daily quota reset time.

### Root Cause 2: Summarization Uses Same Model (By Design)

In `js/src/session/summary.ts:97-105`, the summarization system was changed in [issue #217](https://github.com/link-assistant/agent/issues/217) to use the same model as `--model` instead of a cheaper small model:

```typescript
// Use the same model as the main session (--model) instead of a small model
// This ensures consistent behavior and uses the model the user explicitly requested
log.info(() => ({
  message: 'loading model for summarization',
  providerID: assistantMsg.providerID,
  modelID: assistantMsg.modelID,
  hint: 'Using same model as --model (not a small model)',
}));
```

This creates **double pressure** on rate-limited free-tier models: every step generates both a main model call AND a summarization model call to the same endpoint.

### Root Cause 3: Retry Mechanism Accepts 17-Hour Delays

The `retry-fetch.ts` wrapper has a `RETRY_TIMEOUT` of **168 hours (7 days)**. Since the 17-hour retry-after (62,288s) is less than 168 hours, the system **accepts this delay** and attempts to sleep for ~18 hours:

```
"delayMs": 64614691        # ~17.95 hours (retry-after + jitter)
"remainingTimeoutMs": 604799654   # ~168 hours remaining
```

However, the system doesn't actually sleep for 17 hours — it appears the rate limit retry runs in the background while the main prompt loop continues making new requests (which also get rate-limited). This creates a cascade of rate-limit-retry-rate-limit cycles.

### Root Cause 4: Upstream API Instability (Cloudflare 524)

After the initial rate limit storm, the agent began receiving **Cloudflare 524 "A timeout occurred"** errors from `api.minimax.io`. This indicates the upstream MiniMax API server was:
- Timing out on processing requests (origin server didn't respond within Cloudflare's timeout)
- Potentially rate-limiting at the infrastructure level (beyond API-level 429s)

The 8 retry attempts with exponential backoff (06:45:50 - 07:04:48) consumed ~19 minutes with zero useful work.

### Root Cause 5: Socket Connection Closure

The final failure was `"The socket connection was closed unexpectedly"`. This is a known issue with Bun's fetch() implementation (see [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439)), but in this case it was likely triggered by the MiniMax API dropping the connection after sustained rate limiting.

## Impact

1. **No useful output:** Despite running for 32 minutes, no code was written or committed to PR #2
2. **Wasted compute resources:** 25 successful model steps were completed but led to no tangible result
3. **Poor user experience:** The failure log is 30,273 lines long, making it difficult to diagnose
4. **Silent degradation:** The system appeared to make progress (tool calls were executing) but was cycling between rate limits and partial responses

## Proposed Solutions

### Solution 1: Use Different Model for Summarization When Rate-Limited (Recommended)

**Problem:** Summarization uses the same rate-limited model, doubling API pressure.

**Fix:** Add a fallback in `session/summary.ts` that detects when the main model is rate-limited and falls back to a different model for summarization (e.g., `gpt-5-nano` which is already configured as the compaction model, or use `Provider.getSmallModel()` which exists in `provider.ts:1709-1761`).

```typescript
// Proposed change in summary.ts
const model = await Provider.getModel(
  assistantMsg.providerID,
  assistantMsg.modelID
).catch(() => null);

// If main model fails or is rate-limited, fall back to small model
if (!model) {
  const smallModel = await Provider.getSmallModel(assistantMsg.providerID);
  // use smallModel for summarization
}
```

**Existing component:** `Provider.getSmallModel()` in `js/src/provider/provider.ts:1709-1761` already has a priority list of cheap models per provider.

### Solution 2: Add Maximum Retry-After Threshold for Free-Tier Models

**Problem:** The system accepts 17-hour retry-after values because the global timeout is 168 hours.

**Fix:** Add a configurable `AGENT_MAX_RETRY_AFTER` threshold (e.g., 30 minutes default). If `retry-after` exceeds this, fail fast or switch to a fallback model instead of sleeping for hours.

**Existing component:** The `retry-fetch.ts` already has the `maxRetryTimeout` check (line 116). A new `maxRetryAfter` parameter would cap individual retry-after values independently of the global timeout.

### Solution 3: Implement Model Fallback Chain

**Problem:** When a model is rate-limited, there's no automatic fallback to alternative models.

**Fix:** Implement a fallback model chain similar to [pydantic-ai's FallbackModel](https://github.com/pydantic/pydantic-ai/issues/3267) or [Vercel AI SDK Discussion #3387](https://github.com/vercel/ai/discussions/3387). When the primary model returns 429 with a long retry-after, automatically switch to an alternative model.

**Related libraries:**
- **LiteLLM:** Provides model fallback and load balancing across providers
- **OpenRouter:** Supports automatic model fallback via their API
- **Vercel AI SDK FallbackModel:** Pattern for fallback model chains (not yet fully implemented)

### Solution 4: Rate-Limit-Aware Request Budgeting

**Problem:** The system doesn't track how many requests remain in the quota.

**Fix:** Parse rate limit headers (`x-ratelimit-remaining`, `x-ratelimit-reset`) from successful responses to proactively detect when quota is running low. When remaining requests are below a threshold, switch to a more economical mode (fewer summarization calls, batched compaction).

### Solution 5: Separate Summarization Rate-Limit Tracking

**Problem:** Summarization and main model calls share the same rate-limited endpoint but aren't coordinated.

**Fix:** Add a shared rate-limit tracker that prevents summarization calls when the main model is already rate-limited. This would be a lightweight in-memory counter that both the main prompt loop and summarization system check before making API calls.

## Key Files

| File | Relevance |
|------|-----------|
| `js/src/session/summary.ts:97-117` | Summarization model selection (uses same model as `--model`) |
| `js/src/provider/retry-fetch.ts` | Rate limit retry logic with 168h global timeout |
| `js/src/session/prompt.ts:546-554` | Compaction model selection (separate from summarization) |
| `js/src/session/compaction.ts:43-48` | CompactionModelConfig interface |
| `js/src/provider/provider.ts:1709-1761` | `getSmallModel()` - existing cheap model fallback (unused for summarization) |
| `js/src/cli/model-config.js:172-232` | `parseCompactionModelConfig()` CLI parsing |
| `js/src/session/retry.ts` | Session-level retry state tracking |

## References

- **Issue:** [link-assistant/agent#223](https://github.com/link-assistant/agent/issues/223)
- **Failed PR:** [bpmbpm/bpm-tensor#2](https://github.com/bpmbpm/bpm-tensor/pull/2)
- **Full log (gist):** [solution-draft-log-pr-1774941236637.txt](https://gist.githubusercontent.com/konard/7c270eb491745dc3d03e8a9b275154a2/raw/fbb2029c5896008dc7cb55046aa890ca048048a1/solution-draft-log-pr-1774941236637.txt)
- **Summarization model change:** [link-assistant/agent#217](https://github.com/link-assistant/agent/issues/217)
- **Rate limit retry improvements:** [link-assistant/agent#167](https://github.com/link-assistant/agent/issues/167), [#183](https://github.com/link-assistant/agent/issues/183)
- **Bun socket timeout issue:** [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439)
- **Vercel AI SDK rate limit headers:** [vercel/ai#7247](https://github.com/vercel/ai/issues/7247)
- **Vercel AI SDK model fallback discussion:** [vercel/ai#3387](https://github.com/vercel/ai/discussions/3387)
- **MiniMax rate limits docs:** [platform.minimax.io/docs/guides/rate-limits](https://platform.minimax.io/docs/guides/rate-limits)
- **OpenCode Go pricing/limits:** [opencode.ai/go](https://opencode.ai/go)
