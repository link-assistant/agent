# Case Study: Issue #208 — Agent CLI was not able to finish its work

## Issue Reference

- **GitHub Issue**: https://github.com/link-assistant/agent/issues/208
- **Related PR (Draft)**: https://github.com/link-assistant/agent/pull/209
- **Log Gist**: https://gist.githubusercontent.com/konard/642e9c6e87bac2824400accbd9fe36f7/raw/169d0f71e52a7bef5bbadf3a047964c3c418cb6a/solution-draft-log-pr-1772525512219.txt
- **Agent Version**: `@link-assistant/agent` v0.16.12 (installed globally via Bun)
- **Solve Version**: v1.25.7
- **Date**: 2026-03-03T08:11:20.440Z

## Summary

The `solve` tool was invoked to solve issue [bpmbpm/family-tree#49](https://github.com/bpmbpm/family-tree/issues/49)
using `--model kimi-k2.5-free`. The agent CLI started successfully, sent its first prompt to the
`opencode/kimi-k2.5-free` provider, and immediately received a **401 Unauthorized** HTTP response
with body `{"type":"error","error":{"type":"ModelError","message":"Model kimi-k2.5-free not supported"}}`.

Because the error was marked `isRetryable: false` by the AI SDK, the agent did **not** retry and
instead propagated the error as a `session.error` event. The `solve` wrapper detected the error
string in the output via a fallback pattern match and terminated with:

```
❌ Agent reported error: Model kimi-k2.5-free not supported
```

The agent CLI process exited with code 0 (no crash — clean exit after error propagation), but no
work was done on the target issue.

## Timeline of Events

| Timestamp | Event |
|-----------|-------|
| `08:11:20.440Z` | `solve` invoked: `solve https://github.com/bpmbpm/family-tree/issues/49 --tool agent --model kimi-k2.5-free --attach-logs --verbose --no-tool-check --auto-resume-on-limit-reset --auto-restart-until-mergeable --tokens-budget-stats` |
| `08:11:20.884Z` | Solve v1.25.7 starts |
| `08:11:21.367Z` | Security warning: `--attach-logs` is enabled (5-second countdown) |
| `08:11:26.404Z` | Disk check: 48613MB available ✅ |
| `08:11:26.406Z` | Memory check: 10568MB available ✅ |
| `08:11:26.421Z` | Tool connection validation skipped (`--no-tool-check`) |
| `08:11:27.075Z` | Repository visibility: public |
| `08:11:27.421Z` | Fork mode enabled (no write access to `bpmbpm/family-tree`) |
| `08:11:28.811Z` | No existing PRs for issue #49 — creating new PR |
| `08:11:28.812Z` | Temporary directory created: `/tmp/gh-issue-solver-1772525488812` |
| `08:11:30.444Z` | Fork `konard/bpmbpm-family-tree` confirmed to exist |
| `08:11:32.958Z` | Repo cloned to `/tmp/gh-issue-solver-1772525488812` |
| `08:11:33.334Z` | Upstream `bpmbpm/family-tree` synced |
| `08:11:34.801Z` | Branch `issue-49-f48a7de9d124` created from `main` |
| `08:11:34.840Z` | `.gitkeep` file created and committed |
| `08:11:35.060Z` | Git status: clean |
| `08:11:35.139Z` | Branch pushed to `origin issue-49-f48a7de9d124` |
| `08:11:35.995Z` | Push exit code: 0 |
| `08:11:40.569Z` | Draft PR created: `https://github.com/bpmbpm/family-tree/pull/50` |
| `08:11:43.567Z` | WARNING: PR not linked to issue (fork mode cross-repo limitation) |
| `08:11:48.962Z` | No uncommitted changes found for feedback context |
| `08:11:49.374Z` | Model vision capability: not supported |
| `08:11:49.379Z` | Agent command: `cat ... \| agent --model opencode/kimi-k2.5-free --verbose` |
| `08:11:49.968Z` | Agent started in continuous listening mode (status: `completed`) |
| `08:11:49.984Z` | Session started |
| `08:11:49.994Z` | Level: error logged immediately (provider failure) |
| `08:11:49.998Z` | `rawModel = "opencode/kimi-k2.5-free"`, `modelID = "kimi-k2.5-free"` |
| `08:11:50.062Z` | models.json cache read for model resolution |
| `08:11:50.115Z` | `model not found in provider` — will attempt anyway |
| `08:11:50.125Z` | Session started again |
| `08:11:50.189Z` | `model found after cache refresh` — `kimi-k2.5-free` found |
| `08:11:50.198Z` | `model resolved successfully` — `resolvedModelID = "kimi-k2.5-free"` |
| `08:11:50.400Z` | `session.status` published |
| `08:11:50.783Z` | Error received from provider: HTTP 401 |
| `08:11:50.923Z` | Response body: `{"type":"error","error":{"type":"ModelError","message":"Model kimi-k2.5-free not supported"}}` |
| `08:11:50.924Z` | `session.error` published |
| `08:11:50.925Z` | Error details: `APIError`, `statusCode: 401`, `isRetryable: false` |
| `08:11:50.929Z` | `session.prompt` cancelled |
| `08:11:50.931Z` | `session.idle` published |
| `08:11:50.935Z` | Instance disposing (`/tmp/gh-issue-solver-1772525488812`) |
| `08:11:50.952Z` | Fallback pattern match detects error: "Model kimi-k2.5-free not supported" |
| `08:11:50.955Z` | `❌ Agent reported error: Model kimi-k2.5-free not supported` |
| `08:11:50.956Z` | Error JSON: `exitCode: 0, errorDetectedInOutput: true, errorType: AgentError, limitReached: false` |
| `08:11:51.135Z` | Failure logs being attached to Pull Request |

## Affected Run Details

- **Log file**: `solution-draft-log.txt` (1920 lines, downloaded from gist)
- **Model requested**: `kimi-k2.5-free` (passed as `opencode/kimi-k2.5-free` to agent)
- **Provider**: OpenCode (via `@ai-sdk/openai-compatible`)
- **HTTP Status**: 401 Unauthorized
- **Error type**: `ModelError` (from OpenCode/OpenRouter API)
- **isRetryable**: `false` (set by AI SDK based on non-2xx, non-429 status)
- **Duration from agent start to failure**: ~1 second (08:11:49.425Z → 08:11:50.955Z)
- **Response origin**: Cloudflare CDN (`cf-ray: 9d672c39ca5910d7-ORD`)

## Root Cause Analysis

### Primary Root Cause: Model No Longer Supported by OpenCode Provider

The immediate cause is that the OpenCode API returned:

```json
{"type":"error","error":{"type":"ModelError","message":"Model kimi-k2.5-free not supported"}}
```

with HTTP status 401. The model `kimi-k2.5-free` was previously available via the OpenCode
provider (it was being used successfully as recently as issue #206, merged 2026-02-27), but at
the time of this run (2026-03-03), the OpenCode provider rejected it.

This is an **external provider change** — the OpenCode API removed or restricted access to the
`kimi-k2.5-free` model. This is consistent with:
- The model being listed in the local `models.json` cache (so the agent thought it was valid)
- The cache containing stale data from before the provider removed the model

### Secondary Causes

#### 1. Stale Model Cache

The agent successfully resolved `kimi-k2.5-free` from the local cache:
```
"message": "model found after cache refresh"
"modelID": "kimi-k2.5-free"
"message": "model resolved successfully"
```

But the "cache refresh" apparently still returned stale data (the model was in cache),
or the `models.dev` registry still listed the model even though the OpenCode provider no
longer accepted it. The agent proceeded to call the API with this model, only to find it
was rejected at runtime.

#### 2. Misleading HTTP Status Code

The OpenCode API returned **401 Unauthorized** for a `ModelError`, which is semantically
incorrect. A 401 typically means "authentication required" or "invalid credentials", not
"model not found/supported". The correct HTTP status for "model not supported" would be
**400 Bad Request** or **404 Not Found**.

This mismatch has downstream consequences:
- The `isRetryable: false` flag is set correctly (401s should not be retried)
- But logging/observability tools may interpret the 401 as an authentication problem
- The `solve` fallback pattern match detects the error string in output rather than
  a structured error event, indicating the error surfacing could be improved

#### 3. No Automatic Model Fallback

When the primary model fails with a non-retryable error, the agent terminates completely.
There is no mechanism to fall back to an alternative model or provider. The `--auto-restart-until-mergeable`
flag was set but could not help here because the error is classified as non-retryable and
the agent exited cleanly with code 0 before the restart logic could trigger a meaningful retry.

#### 4. --auto-restart-until-mergeable Does Not Help Non-Retryable Errors

The `solve` tool was invoked with `--auto-resume-on-limit-reset` and `--auto-restart-until-mergeable`,
but these flags only help when:
- Token/rate limits are hit (`limitReached: true`)
- The agent can be resumed from a previous session

When `isRetryable: false` and `limitReached: false`, the solve wrapper sees a clean failure
and does not attempt automatic restarts. The error exits immediately.

## Sequence of Events (Reconstructed)

```
solve invoked
  → fork & clone repo (OK)
  → create branch + draft PR (OK)
  → launch agent: `agent --model opencode/kimi-k2.5-free --verbose`
    → agent starts in continuous mode (OK)
    → reads system prompt & initial message (OK)
    → resolves model kimi-k2.5-free from cache (OK - cached)
    → sends first prompt to OpenCode API via HTTP
    → OpenCode API responds: 401 + {"type":"ModelError","message":"Model kimi-k2.5-free not supported"}
    → AI SDK marks error: isRetryable=false
    → SessionProcessor catches APIError
    → isRetryableAPIError = false → no retry
    → session.error published
    → session.prompt cancelled
    → session.idle published
    → instance disposed
  → solve detects error via fallback pattern match
  → solve terminates: exitCode=0, errorDetectedInOutput=true
  → logs attached to draft PR
```

## Impact

- The target issue (`bpmbpm/family-tree#49`) received no work done
- A draft PR (`https://github.com/bpmbpm/family-tree/pull/50`) was created with only a `.gitkeep` file
- No code changes, analysis, or solution drafts were produced
- Total wall clock time wasted: ~30 seconds (mostly setup/clone/push)
- No cost was incurred (model API never processed a request successfully)

## Existing Handling in Codebase

The error handling chain works correctly for this type of failure:

1. `retry-fetch.ts`: Only retries HTTP 429 (rate limits) — 401 passes through
2. `message-v2.ts` (`fromError`): Converts `APICallError` → `MessageV2.APIError` with
   `isRetryable` from AI SDK's `APICallError.isRetryable`
3. `processor.ts`: Only retries when `isRetryable === true` — exits loop on false
4. `session/index.ts`: Publishes `session.error` event
5. `solve` wrapper: Detects error in output, terminates

The chain is correct but there is no model fallback or user guidance beyond the raw error message.

## Proposed Solutions

### Solution 1: Add Model Validation at Startup (Early Fail with Clear Message)

Before sending any user prompt to the model, perform a lightweight validation call
(or HEAD request) to verify the model is accessible. If the model returns 401/404,
immediately surface a clear diagnostic message:

```
❌ Model 'kimi-k2.5-free' is not supported by the OpenCode provider.
   HTTP 401: Model kimi-k2.5-free not supported
   
   Suggestions:
   - Check available models: agent --list-models opencode
   - Try a different model: agent --model opencode/moonshot-v1-8k
   - Check provider status: https://opencode.ai/status
```

This avoids spending time on setup (clone, branch, PR creation) before discovering the model is unavailable.

### Solution 2: Invalidate Model Cache on 401/404 ModelError

When the API returns a `ModelError` with 401/404 status, invalidate the model cache
for that provider and refresh from `models.dev`. This ensures stale cached models are
removed and future runs reflect the current provider state.

### Solution 3: Auto-Retry with Alternative Model (Fallback Chain)

Allow specifying a fallback model chain via CLI or config:

```bash
agent --model opencode/kimi-k2.5-free --fallback-model opencode/moonshot-v1-8k
```

Or in config:
```json
{
  "model": "kimi-k2.5-free",
  "fallbackModels": ["moonshot-v1-8k", "gpt-4o-mini"]
}
```

When the primary model fails with a non-retryable `ModelError`, automatically switch
to the next model in the fallback chain.

### Solution 4: Detect "not supported" Errors and Trigger --auto-restart-until-mergeable

Extend the `--auto-restart-until-mergeable` logic to also handle `ModelError` cases
by prompting the user to specify a different model or by trying alternative known-good
models automatically.

### Solution 5: Report Upstream to OpenCode/OpenRouter

The HTTP 401 response for "model not supported" is semantically incorrect and confusing.
File an upstream bug report at the OpenCode API project to use the correct HTTP status
(400 Bad Request or 404 Not Found) for model-not-supported errors.

This would help:
- Distinguish auth failures (real 401) from model-not-found (should be 400/404)
- Potentially enable retryable classification for transient model unavailability vs
  permanent model removal

## External References

- **OpenRouter model list**: https://openrouter.ai/models (check if `kimi-k2.5-free` is still listed)
- **MoonshotAI Kimi K2.5**: https://platform.moonshot.ai (primary provider for kimi models)
- **OpenCode API**: https://opencode.ai (proxy/gateway used in this run)
- **Bun idle timeout bug**: https://github.com/oven-sh/bun/issues/14439 (unrelated but referenced in retry-fetch.ts)
- **AI SDK APICallError**: https://sdk.vercel.ai/docs/reference/ai-sdk-core/api-call-error

## Related Issues and PRs

| Issue/PR | Description |
|----------|-------------|
| [Issue #206](https://github.com/link-assistant/agent/issues/206) | No debug HTTP in --verbose mode |
| [PR #207](https://github.com/link-assistant/agent/pull/207) | Fix: check verbose flag at HTTP call time |
| [Issue #204](https://github.com/link-assistant/agent/issues/204) | agent --model kimi-k2.5-free --verbose fails |
| [PR #205](https://github.com/link-assistant/agent/pull/205) | feat: log HTTP response body in verbose mode |
| [Issue #200](https://github.com/link-assistant/agent/issues/200) | Model resolution and error serialization |
| [Issue #183](https://github.com/link-assistant/agent/issues/183) | Long rate limit wait aborted by provider timeout |
| [Issue #167](https://github.com/link-assistant/agent/issues/167) | Fetch-level rate limit retry (retry-fetch.ts) |

## Files Relevant to This Issue

| File | Relevance |
|------|-----------|
| `js/src/provider/provider.ts` | Model resolution, SDK creation, fetch wrapping |
| `js/src/provider/retry-fetch.ts` | HTTP-level retry logic (429 only, not 401) |
| `js/src/session/processor.ts` | Stream processing, error detection, retry loop |
| `js/src/session/retry.ts` | Retry delay calculation, `shouldRetry()` logic |
| `js/src/session/message-v2.ts` | `fromError()` converts AI SDK errors to typed errors |
| `js/src/flag/flag.ts` | Runtime flags (RETRY_TIMEOUT, MAX_RETRY_DELAY, etc.) |

## Data Files

- `solution-draft-log.txt` — Full 1920-line log from the failing run (gist: `642e9c6e87bac2824400accbd9fe36f7`)
