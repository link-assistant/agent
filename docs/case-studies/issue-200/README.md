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

## Solution Implemented

1. **HTTP-level verbose logging** (`provider.ts`): When `--verbose` is enabled, every HTTP request/response is logged as JSON including:
   - URL, method, sanitized headers (API keys masked)
   - Request body preview (truncated to 2000 chars)
   - Response status, status text, headers, duration

2. **Improved error messages** (`provider.ts:getModel`): `ProviderModelNotFoundError` now includes available models in the provider, making it immediately clear what went wrong.

## Data Files

- `pr851-issue-comments.json` — Comments from godot-topdown-MVP PR #851
- `pr850-issue-comments.json` — Comments from godot-topdown-MVP PR #850
- `pr424-issue-comments.json` — Comments from rdf-grapher PR #424
- `pr851-review-comments.json` — Review comments from PR #851

## Recommendations

1. **Monitor models.dev sync**: Consider adding a health check that verifies model availability before task execution.
2. **Fallback model support**: When a specific model fails, automatically suggest alternatives from the same provider.
3. **Structured error events**: Publish model resolution failures as bus events so the UI can display actionable messages.
