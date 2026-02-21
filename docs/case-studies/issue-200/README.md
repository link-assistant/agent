# Case Study: Issue #200 — Models Not Working / Insufficient Debug Output

## Summary

Multiple users reported that the Agent CLI tool was failing to complete tasks. Investigation revealed two distinct failure modes, both stemming from provider/model resolution issues with insufficient error visibility.

## Timeline of Events

1. **Issue #194** (earlier): Premature loop termination when `finishReason` was `undefined` — provider compatibility fix added to infer `tool-calls` finish reason.
2. **Issue #196**: Zero-token provider failures not properly detected — validation and warning added.
3. **Issue #198**: `Provider.state` was not exported, causing `TypeError` during model validation — fix exported the state.
4. **Issue #200** (this issue): Despite fixes to #194/#196/#198, models still fail in production. Root cause: insufficient HTTP-level logging makes debugging impossible.

## Affected Pull Requests

### PR #851 (godot-topdown-MVP) & PR #850 (godot-topdown-MVP)
- **Error:** `ProviderModelNotFoundError`
- **Requested model:** `kilo/glm-5-free` (PR #851) and `opencode/kimi-k2.5-free` (PR #850)
- **Root cause:** Model alias resolution resolved `kilo/glm-5-free` to `opencode/kimi-k2.5-free`, but `kimi-k2.5-free` was not available in the `opencode` provider's model catalog.
- **Available models in opencode:** `trinity-large-preview-free`, `glm-5-free`, `big-pickle`, `minimax-m2.5-free`, `gpt-5-nano`

### PR #424 (rdf-grapher)
- **Error:** `UnknownError` — Provider returned zero tokens with unknown finish reason
- **Context:** Agent successfully created branch and PR but failed during first analysis step
- **Root cause:** Provider failed silently — no HTTP-level details available to diagnose

## Root Cause Analysis

### Primary Issue: No HTTP-Level Logging
The `--verbose` mode only logged high-level information (model config, system prompt, token estimates). When the AI SDK or provider failed, there was **zero visibility** into:
- What URL was called
- What HTTP status was returned
- What the response body contained
- Request/response headers
- Request timing

### Secondary Issue: Poor Error Messages
When a model was not found in a provider, the error simply said `ProviderModelNotFoundError` with the provider/model IDs but did not list what models **were** available, making it hard to spot typos or misconfiguration.

### Tertiary Issue: Model Catalog Sync
The models.dev API catalog can become stale. Models listed as available may be removed by providers without notice, causing `ProviderModelNotFoundError` at runtime.

## Solution Implemented (PR #202)

### 1. Fix default model (root cause fix)
Changed the hardcoded default model from the removed `opencode/kimi-k2.5-free` to `kilo/glm-5-free` which is a stable free model in the Kilo Gateway. Updated all references across:
- `index.js` (CLI default)
- `tool/task.ts` (subagent fallback)
- `cli/model-config.js` (validation messages and OAuth redirect)
- `provider/provider.ts` (small model priority lists)

### 2. Safe JSON error serialization
Added cyclic-reference-safe JSON serializer in `cli/output.ts`:
- Handles cyclic references (returns `[Circular]` instead of throwing)
- Serializes Error objects to plain objects with name, message, stack, cause
- Handles BigInt values
- Fallback for serialization failures (guaranteed JSON output)

### 3. Robust global error handlers
Improved `uncaughtException` and `unhandledRejection` handlers in `index.js`:
- Wrapped in try/catch to prevent serialization failures from causing non-JSON output
- Include error.data in rejection output for debugging ProviderModelNotFoundError
- Last-resort minimal JSON fallback written directly to stderr

### 4. Model resolution verbose logging
Added debug logging in `session/prompt.ts`:
- Logs model resolution attempts before API calls
- Logs successful resolution with resolved model ID
- Logs failures with stack trace and troubleshooting hints

### 5. HTTP-level verbose logging (already existed)
When `--verbose` is enabled, every HTTP request/response is logged as JSON including:
- URL, method, sanitized headers (API keys masked)
- Request body preview (truncated to 2000 chars)
- Response status, status text, headers, duration

### 6. Unit tests
Added `tests/safe-json-serialization.test.ts` with 7 tests covering:
- Simple message serialization
- Cyclic reference handling
- Error object serialization
- Nested cyclic references
- Null/undefined handling
- Compact vs pretty mode
- Error cause chain serialization

## Data Files

- `logs.md` — Detailed error logs extracted from all affected PRs
- `pr851-issue-comments.json` — Comments from godot-topdown-MVP PR #851
- `pr850-issue-comments.json` — Comments from godot-topdown-MVP PR #850
- `pr424-issue-comments.json` — Comments from rdf-grapher PR #424
- `pr851-review-comments.json` — Review comments from PR #851

## Comparison with Reference Implementations

### kilo-Org/kilo
- Uses `ModelCache` with 5-minute TTL for model catalog (`provider/model-cache.ts`)
- Has `@kilocode/kilo-gateway` package for dynamic model fetching
- Our approach: uses `models.dev/api.json` with 1-hour cache staleness threshold

### anomalyco/opencode
- Has comprehensive `ProviderError` module (`provider/error.ts`) with:
  - Context overflow detection patterns for 12+ providers
  - Stream error parsing (`parseStreamError`) for structured error handling
  - API call error parsing with retryable classification
- Our code has similar but less comprehensive error parsing in `session/message-v2.ts`

## Recommendations

1. **Dynamic default model**: Instead of hardcoding a default, use `Provider.defaultModel()` which already has smart fallback logic
2. **Model availability check**: Add pre-flight check during startup to verify default model exists
3. **Port ProviderError patterns**: Adopt overflow detection patterns from opencode for better error classification
4. **Structured error events**: Publish model resolution failures as bus events for UI display
