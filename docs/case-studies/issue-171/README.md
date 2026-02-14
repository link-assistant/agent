# Case Study: Issue #171 - `--model kilo/glm-5-free` Returns Unauthorized Error

## Summary

When users ran `agent --model kilo/glm-5-free`, the agent failed with `AI_APICallError: Unauthorized`. Initial investigation (v0.12.1) misdiagnosed the issue as a stale Bun cache problem and added a `rawModel` logging field. Deeper investigation revealed **six distinct root causes** spanning wrong API endpoints, wrong SDK packages, wrong API keys, missing device authentication, incorrect model ID mappings, and absent auth plugin support. This case study documents the full investigation, the layered nature of the failures, and the eventual fix.

## Issue Details

- **Issue URL**: https://github.com/link-assistant/agent/issues/171
- **Reporter**: konard
- **Date**: 2026-02-14
- **Agent Version**: 0.12.1 (at time of report)
- **Related Issues**: #165 (initial model routing misidentification)
- **Severity**: Critical -- Kilo provider was completely non-functional

## Timeline of Events

### Phase 1: Initial Failure (User Report)

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2026-02-14T11:37:01.071Z | User executed: `solve https://github.com/andchir/realtime_chat/issues/1 --tool agent --model kilo/glm-5-free --verbose` |
| 2026-02-14T11:37:06.590Z | System checks passed (disk: 53971MB, memory: 8842MB) |
| 2026-02-14T11:37:22.596Z | Issue title fetched: "Napisat' veb interfejs s primerom chata" |
| 2026-02-14T11:37:25.528Z | Draft PR #2 created at `andchir/realtime_chat` |
| 2026-02-14T11:37:32.064Z | Agent execution begins: `Model: kilo/glm-5-free` |
| 2026-02-14T11:37:32.540Z | Agent v0.12.1 started in continuous mode |
| 2026-02-14T11:37:32.566Z | **BUG**: Model resolved as `opencode/kimi-k2.5-free` instead of `kilo/glm-5-free` |
| 2026-02-14T11:37:32.626Z | SDK package `@ai-sdk/openai-compatible` loaded (wrong SDK) |
| 2026-02-14T11:37:33.093Z | API returns rate limit: `retry-after: 44548` seconds (~12.4 hours) |
| 2026-02-14T11:37:33.367Z | Second attempt also rate-limited: `retry-after: 44547` seconds |
| 2026-02-14T11:42:32.575Z | Operation timed out after 5 minutes |
| 2026-02-14T11:47:32.745Z | Retry sleep aborted, returning last response |
| 2026-02-14T11:49:41.782Z | Process terminated with error: `"The operation timed out."` |

### Phase 2: Initial Misdiagnosis (v0.12.1 Fix)

The first investigation (commit `7eaf5a2`) incorrectly attributed the failure to:
- A stale Bun cache preventing the model routing fix from taking effect
- Recommended `bun pm cache rm` and reinstall as the solution

This fix added a `rawModel` logging field but did not address the actual API integration issues.

### Phase 3: Deep Investigation and Fix

Further investigation revealed that even with correct model routing (`kilo` provider selected, `glm-5-free` model ID parsed), the API calls would still fail due to six distinct problems in the Kilo provider implementation.

## Root Cause Analysis

### Overview

The Kilo provider integration had **six compounding failures**. Fixing any single one would not have resolved the issue -- all six needed to be addressed together.

```
User Request: kilo/glm-5-free
       |
       v
[1] Wrong API Endpoint ---- api/gateway vs api/openrouter
       |
       v
[2] Wrong SDK Package ----- @ai-sdk/openai-compatible vs @openrouter/ai-sdk-provider
       |
       v
[3] Wrong Anonymous Key --- 'public' vs 'anonymous'
       |
       v
[4] No Device Auth -------- Anonymous key rejected for completions
       |
       v
[5] Wrong Model IDs ------- z-ai/glm-5 vs z-ai/glm-5:free
       |
       v
[6] No Auth Plugin -------- No way to authenticate via `agent auth login`
       |
       v
   FAILURE: AI_APICallError: Unauthorized
```

### Root Cause 1: Wrong API Endpoint

| Attribute | Incorrect (Before) | Correct (After) |
|-----------|-------------------|-----------------|
| Base URL  | `https://api.kilo.ai/api/gateway` | `https://api.kilo.ai/api/openrouter` |

The Kilo Gateway exposes an **OpenRouter-compatible** API at `/api/openrouter`, not a generic OpenAI-compatible gateway at `/api/gateway`. The `/api/gateway` endpoint does not exist or returns authentication errors for all requests.

**Reference**: Kilo's own source code in `packages/kilo-gateway/src/api/constants.ts` defines the base URL as the OpenRouter-compatible endpoint.

### Root Cause 2: Wrong SDK Package

| Attribute | Incorrect (Before) | Correct (After) |
|-----------|-------------------|-----------------|
| SDK Package | `@ai-sdk/openai-compatible` | `@openrouter/ai-sdk-provider` |

Kilo internally wraps `@openrouter/ai-sdk-provider` (via `@kilocode/kilo-gateway`). The OpenRouter SDK follows different conventions from the generic OpenAI-compatible SDK, including different header requirements and model ID formats.

**Evidence from failure log** (line 582-583):
```json
{
  "service": "provider",
  "providerID": "opencode",
  "pkg": "@ai-sdk/openai-compatible",
  "version": "latest",
  "message": "installing provider package"
}
```

### Root Cause 3: Wrong Anonymous API Key

| Attribute | Incorrect (Before) | Correct (After) |
|-----------|-------------------|-----------------|
| Anonymous Key | `'public'` | `'anonymous'` |

The Kilo API uses `'anonymous'` as its unauthenticated API key constant (`ANONYMOUS_API_KEY` in `packages/kilo-gateway/src/api/constants.ts`), not `'public'` which is used by the OpenCode Zen provider. This distinction matters because the API validates the key format.

### Root Cause 4: Anonymous Access Does Not Work for Completions

Even with the correct URL (`/api/openrouter`) and correct anonymous key (`'anonymous'`), the Kilo API returns:

```json
{"error": "Invalid token (uuid)", "success": false}
```

This is because the Kilo API **requires device authentication** for chat completions, even for free models. Anonymous access only works for the `/models` listing endpoint. Users must complete the device auth flow (similar to GitHub device flow) to obtain a valid session token.

**Implication**: The "free models work out of the box with no configuration" claim in the original documentation was incorrect. Users must run `agent auth login` first.

### Root Cause 5: Wrong Model ID Mappings

All model ID mappings in the provider configuration were incorrect when compared against the actual Kilo API response from `https://api.kilo.ai/api/openrouter/models`:

| Agent Model ID | Previous Mapping (Wrong) | Correct Mapping | Issue |
|----------------|------------------------|-----------------|-------|
| `glm-5-free` | `z-ai/glm-5` | `z-ai/glm-5:free` | Missing `:free` suffix; non-free is a paid model |
| `glm-4.7-free` | `z-ai/glm-4.7:free` | N/A (does not exist) | Model not available on Kilo API |
| `kimi-k2.5-free` | `moonshot/kimi-k2.5:free` | N/A | Provider prefix is `moonshotai`, not `moonshot`; not free on Kilo |
| `minimax-m2.1-free` | `minimax/m2.1:free` | N/A | M2.1 replaced by M2.5 on the API |
| `giga-potato-free` | `giga-potato:free` | `giga-potato` | API uses bare name without `:free` suffix |
| `trinity-large-preview` | `arcee/trinity-large-preview` | `arcee-ai/trinity-large-preview:free` | Provider prefix is `arcee-ai`, not `arcee`; missing `:free` suffix |

**Corrected model map** (from commit `57bb535`):

| Agent Model ID | API Model ID | Notes |
|----------------|-------------|-------|
| `glm-5-free` | `z-ai/glm-5:free` | Free tier of GLM-5 |
| `glm-4.5-air-free` | `z-ai/glm-4.5-air:free` | Replaced glm-4.7-free (which did not exist) |
| `minimax-m2.5-free` | `minimax/minimax-m2.5:free` | Replaced minimax-m2.1-free |
| `giga-potato-free` | `giga-potato` | No `:free` suffix needed |
| `trinity-large-preview` | `arcee-ai/trinity-large-preview:free` | Correct provider prefix |
| `deepseek-r1-free` | `deepseek/deepseek-r1-0528:free` | Newly added |

### Root Cause 6: No Auth Plugin for Kilo

The agent had no Kilo device authorization plugin, so users had no way to authenticate via `agent auth login`. Without authentication, no completions requests would succeed (see Root Cause 4).

The fix added a complete device auth plugin implementing the Kilo device authorization flow (similar to OAuth device flow), and added Kilo to the auth provider priority list.

## Original Failure Log Analysis

The complete failure log was captured from the `solve` execution on 2026-02-14. Key excerpts and analysis follow.

### Command Executed

```
/home/hive/.nvm/versions/node/v20.20.0/bin/node /home/hive/.bun/bin/solve \
  https://github.com/andchir/realtime_chat/issues/1 \
  --tool agent --model kilo/glm-5-free \
  --attach-logs --verbose --no-tool-check \
  --auto-resume-on-limit-reset --tokens-budget-stats
```

### Model Routing Mismatch

The log shows the model argument was correctly passed but incorrectly resolved:

```json
// Correct: solve passes model correctly
{"service": "default", "command": "... --model kilo/glm-5-free --verbose"}

// Wrong: agent resolves to different provider/model
{
  "service": "default",
  "providerID": "opencode",
  "modelID": "kimi-k2.5-free",
  "message": "using explicit provider/model"
}
```

This confirms the model routing issue from Issue #165 was still present, but it was only the **first** of six problems.

### Provider Discovery

The log shows all three providers were discovered but the wrong one was used:

```json
{"service": "provider", "providerID": "opencode", "message": "found"}
{"service": "provider", "providerID": "kilo", "message": "found"}
{"service": "provider", "providerID": "claude-oauth", "message": "found"}
```

### Rate Limiting and Timeout

Because the request was routed to `opencode` instead of `kilo`, it hit OpenCode Zen's rate limiter with a `retry-after` value of approximately 12.4 hours:

```json
{
  "service": "retry-fetch",
  "sessionID": "opencode",
  "attempt": 1,
  "delay": 46327183,
  "delayMinutes": "772.12",
  "message": "rate limited, will retry"
}
```

The operation timed out at `11:42:32` (5 minutes after start), and the retry sleep was aborted at `11:47:32` (10 minutes after start). The final error:

```json
{
  "type": "error",
  "exitCode": 0,
  "errorDetectedInOutput": true,
  "errorType": "AgentError",
  "errorMatch": "The operation timed out.",
  "message": "Agent reported error: The operation timed out."
}
```

### Full Log Reference

The complete failure log is available at:
- **Gist**: https://gist.githubusercontent.com/konard/5348be50cb8d00dff6b8fb89241d5e46/raw
- **Local copy**: [`../../original-failure-log.txt`](../../original-failure-log.txt)

## Solution

The fix was implemented across two commits:

### Commit 1: `44cbffb` - Fix Provider Integration

**Files changed**: `js/src/auth/plugins.ts`, `js/src/cli/cmd/auth.ts`, `js/src/provider/provider.ts`

Changes:
1. **Fixed base URL** from `/api/gateway` to `/api/openrouter`
2. **Switched SDK** from `@ai-sdk/openai-compatible` to `@openrouter/ai-sdk-provider`
3. **Changed anonymous key** from `'public'` to `'anonymous'`
4. **Added required Kilo headers**: `User-Agent` and `X-KILOCODE-EDITORNAME`
5. **Added Kilo device auth plugin** implementing the full device authorization flow
6. **Added Kilo to auth provider priority list**

### Commit 2: `57bb535` - Fix Model ID Mappings

**Files changed**: `js/src/provider/provider.ts`

Changes:
1. **Fixed `glm-5-free`** mapping: `z-ai/glm-5` to `z-ai/glm-5:free`
2. **Replaced `glm-4.7-free`** (nonexistent) with `glm-4.5-air-free` (`z-ai/glm-4.5-air:free`)
3. **Removed `kimi-k2.5-free`** (wrong provider prefix, not free on Kilo)
4. **Replaced `minimax-m2.1-free`** (nonexistent) with `minimax-m2.5-free` (`minimax/minimax-m2.5:free`)
5. **Fixed `giga-potato-free`** mapping: `giga-potato:free` to `giga-potato`
6. **Fixed `trinity-large-preview`** mapping: `arcee/` to `arcee-ai/trinity-large-preview:free`
7. **Added `deepseek-r1-free`**: `deepseek/deepseek-r1-0528:free`

### Previous Fix: `7eaf5a2` - Logging Improvement (v0.12.1)

This earlier commit added `rawModel` field logging to help diagnose model routing issues. While it did not fix the underlying problem, it provided the diagnostic data that made the deeper investigation possible.

## Key References

| Resource | URL / Path |
|----------|-----------|
| Kilo provider source | https://github.com/Kilo-Org/kilo/tree/main/packages/kilo-gateway |
| Kilo API constants | `packages/kilo-gateway/src/api/constants.ts` |
| Kilo device auth flow | `packages/kilo-gateway/src/auth/device-auth.ts` |
| Kilo provider wrapper | `packages/kilo-gateway/src/provider.ts` |
| Kilo models API | `https://api.kilo.ai/api/openrouter/models` |
| Issue #165 case study | [`../issue-165/README.md`](../issue-165/README.md) |

## Lessons Learned

### 1. Always Verify API Endpoints Against Upstream Source Code

The original integration used `https://api.kilo.ai/api/gateway` based on documentation or assumption. The actual endpoint (`/api/openrouter`) was only discoverable by reading Kilo's source code. Documentation URLs and API URLs are not the same thing.

### 2. When a Provider Wraps Another SDK, Use the Same Underlying SDK

Kilo internally wraps `@openrouter/ai-sdk-provider`. Using `@ai-sdk/openai-compatible` instead introduced subtle incompatibilities in header handling, model ID formatting, and request structure. The correct approach is to match the upstream provider's SDK choice.

### 3. "Anonymous" or "Public" API Keys May Work for Listing but Not for Completions

The Kilo API accepts the `anonymous` key for the `/models` endpoint (listing available models) but requires device authentication for `/chat/completions`. This distinction between read-only and write/compute endpoints is common in APIs that offer free tiers and should be tested explicitly.

### 4. Free Models Often Have Different IDs From Their Paid Counterparts

On the Kilo/OpenRouter API, free models use a `:free` suffix (e.g., `z-ai/glm-5:free` vs `z-ai/glm-5`). The paid version works with API keys that have billing; the free version works with device auth. Assuming the model ID from the model name without verifying against the live API led to every single mapping being wrong.

### 5. Model IDs Must Be Verified Against the Live API

Every model ID mapping was incorrect because they were assumed from naming conventions rather than queried from `https://api.kilo.ai/api/openrouter/models`. This should be a standard verification step when adding any provider.

### 6. Device Auth Is Becoming the Standard for Free AI Model Access

Unlike simple API key authentication, device auth (similar to GitHub's device flow) provides rate limiting per device, abuse prevention, and a better user experience for free tiers. Providers using device auth need corresponding auth plugins in the agent.

### 7. Surface-Level Fixes Can Mask Deeper Problems

The v0.12.1 fix (adding `rawModel` logging) was a reasonable diagnostic step but was incorrectly presented as the solution ("clear Bun cache and reinstall"). This delayed discovery of the six actual root causes. When a fix does not include reproduction and verification steps, it should be labeled as diagnostic rather than definitive.

### 8. Integration Bugs Compound

Each of the six root causes would have produced a different error message if it were the only problem. Because all six were present simultaneously, the user saw a single opaque `Unauthorized` error. Fixing them required a systematic approach: fix the endpoint, fix the SDK, fix the key, discover the auth requirement, fix the model IDs, and add the auth plugin.

## Conclusion

Issue #171 was caused by a fundamentally broken Kilo provider integration with six compounding failures: wrong API endpoint, wrong SDK package, wrong anonymous API key, missing device authentication support, incorrect model ID mappings for all listed models, and no auth plugin for the `agent auth login` flow. The initial fix in v0.12.1 misidentified the root cause as a stale Bun cache.

The complete fix required changes to three files across two commits, adding a new device auth plugin, correcting the API integration parameters, and verifying every model ID against the live Kilo API. The key takeaway is that third-party provider integrations should be verified end-to-end against the actual API, using the provider's own SDK and source code as the source of truth.
