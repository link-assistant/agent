# Case Study: Replace Deprecated qwen3.6-plus-free Default with nemotron-3-super-free

**Issue:** [#242](https://github.com/link-assistant/agent/issues/242)
**PR:** [#243](https://github.com/link-assistant/agent/pull/243)

## Problem Statement

OpenCode Zen ended the free promotion for `qwen3.6-plus-free` (Qwen 3.6 Plus Free). The model now requires an OpenCode Go subscription. Since `qwen3.6-plus-free` was the default model for the agent, all users without an OpenCode Go subscription experienced immediate failures when running the agent without specifying an alternative model.

## Timeline of Events

| Timestamp (UTC)        | Event                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| April 2026 (early)     | `qwen3.6-plus-free` set as default model in [PR #234](https://github.com/link-assistant/agent/pull/234) (issue #232) |
| ~April 9, 2026         | OpenCode Zen ends free promotion for Qwen 3.6 Plus Free                                       |
| 2026-04-09T09:10:31Z   | Agent run fails with `ModelError`: "Free promotion has ended for Qwen3.6 Plus Free"           |
| 2026-04-09T09:10:31Z   | Compaction cascade also fails: `ProviderModelNotFoundError` for `qwen3.6-plus-free`            |
| 2026-04-09T09:10:31Z   | Available free models at time of failure: `big-pickle`, `gpt-5-nano`, `nemotron-3-super-free`  |

## Root Cause Analysis

### Primary Cause: External model deprecation

OpenCode Zen removed `qwen3.6-plus-free` from the free tier. The API now returns HTTP 401 with:

```json
{
  "type": "error",
  "error": {
    "type": "ModelError",
    "message": "Free promotion has ended for Qwen3.6 Plus Free. You can continue using the model by subscribing to OpenCode Go - https://opencode.ai/go"
  }
}
```

### Secondary Impact: Compaction cascade failure

The default compaction models cascade included `qwen3.6-plus-free` as the largest-context model:
```
(big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)
```

When the model was removed, the cascade gracefully skipped it (`"skipping unresolvable compaction model in cascade"`), but the configuration was still referencing a non-existent model.

### Tertiary Impact: Provider priority lists

`qwen3.6-plus-free` was listed first in:
- `getSmallModel()` OpenCode priority list (used for title/summary generation)
- Global model sort priority list

## Evidence from Logs

Source: [solution-draft-log.txt](solution-draft-log.txt) (full log from failed run on 2026-04-09)

**Key log entries:**

1. **Model resolution succeeds** (line 648): Model resolves to `qwen3.6-plus-free` via default
2. **Model not in catalog** (line 657): `"model not found - refusing to silently fallback"` — `qwen3.6-plus-free` no longer in available models list
3. **Compaction cascade skip** (line 665): `"error": "ProviderModelNotFoundError"` for `qwen3.6-plus-free`
4. **API error** (line 1679): `"Free promotion has ended for Qwen3.6 Plus Free"`
5. **HTTP 401** (line 1692): `"status": 401, "statusText": "Unauthorized"`

## Available Free Models (Post-Deprecation)

From the log at time of failure (line 649-656):

| Model                  | Provider | Context    | Status                     |
| ---------------------- | -------- | ---------- | -------------------------- |
| big-pickle             | opencode | ~200,000   | Available                  |
| gpt-5-nano             | opencode | ~400,000   | Available                  |
| nemotron-3-super-free  | opencode | ~262,144   | Available                  |
| glm-5-free             | kilo     | ~202,752   | Available                  |
| glm-4.5-air-free       | kilo     | ~131,072   | Available                  |
| minimax-m2.5-free      | kilo     | ~204,800   | Available (Kilo only)      |
| qwen3.6-plus-free      | opencode | ~1,000,000 | **Deprecated (paid only)** |

## Solution

### New Default Model: `opencode/nemotron-3-super-free`

**Rationale:** Among remaining free OpenCode models, `nemotron-3-super-free` has the largest context window (~262K tokens) and strong reasoning capabilities (NVIDIA hybrid Mamba-Transformer architecture). While `gpt-5-nano` has a larger context (~400K), `nemotron-3-super-free` is better suited as a primary model due to its stronger general-purpose agent performance.

### Changes Made

1. **`js/src/cli/defaults.ts`**: Changed `DEFAULT_MODEL` from `opencode/qwen3.6-plus-free` to `opencode/nemotron-3-super-free`
2. **`js/src/cli/defaults.ts`**: Removed `qwen3.6-plus-free` from compaction models cascade
3. **`js/src/provider/provider.ts`**: Updated `getSmallModel()` and global sort priority lists — removed `qwen3.6-plus-free`
4. **`js/src/cli/argv.ts`**: Updated compaction models comment
5. **Documentation**: Moved `qwen3.6-plus-free` to deprecated/discontinued sections in FREE_MODELS.md, MODELS.md, README.md
6. **Tests**: Updated assertions for new default model and cascade

### Updated Compaction Models Cascade

```
Old: (big-pickle nemotron-3-super-free minimax-m2.5-free gpt-5-nano qwen3.6-plus-free same)
New: (big-pickle minimax-m2.5-free nemotron-3-super-free gpt-5-nano same)
```

Note: `nemotron-3-super-free` is now the default model, so `same` at the end of the cascade effectively includes it. The cascade order remains smallest-to-largest context.

## Lessons Learned

1. **Free model promotions are temporary** — The agent should be resilient to model deprecation. This is the fourth time a default free model has been deprecated (grok-code → kimi-k2.5-free → minimax-m2.5-free → qwen3.6-plus-free).
2. **Compaction cascade provides resilience** — The cascade correctly skipped the unavailable model and continued with available alternatives, preventing total compaction failure.
3. **Verbose logging was critical** — The detailed HTTP response body logging (added in previous PRs) immediately revealed the exact error message from OpenCode Zen.

## Related Issues and PRs

- [Issue #232](https://github.com/link-assistant/agent/issues/232) — Original PR that set `qwen3.6-plus-free` as default
- [Issue #208](https://github.com/link-assistant/agent/issues/208) — Previous default model deprecation (`kimi-k2.5-free`)
- [Issue #133](https://github.com/link-assistant/agent/issues/133) — First default model deprecation (`grok-code`)
