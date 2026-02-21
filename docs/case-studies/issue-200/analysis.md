# Case Study: Issue #200 — Make Models Work Again

## Summary

Models like `kimi-k2.5-free` fail with `ProviderModelNotFoundError` despite being available in the provider's API. All errors should be JSON-only, but Bun runtime outputs plain-text stack traces.

## Timeline of Events

1. **Build time**: `models-macro.ts` fetches `models.dev/api.json` and bundles it into the package
2. **Runtime**: `ModelsDev.get()` uses bundled data or cached `models.json` (1-hour TTL)
3. **Issue**: When the bundled data or cache is stale and missing a model (e.g., `kimi-k2.5-free`), `getModel()` throws `ProviderModelNotFoundError`
4. **Impact**: Agent fails to start, outputs plain-text Bun stack trace alongside JSON logs

## Root Causes

### 1. Stale Model Catalog (Primary)

The model catalog has three layers:
- **Bundled data** (build-time snapshot of `models.dev/api.json`)
- **Cached data** (`~/.cache/agent/models.json`, 1-hour TTL)
- **Live API** (`https://models.dev/api.json`)

When a new model is added to `models.dev` after the package is built, and the cache hasn't been refreshed, the model appears missing even though it exists.

**Evidence from logs** (3 out of 4 PR comments report `ProviderModelNotFoundError`):
- `pr851`: "kimi-k2.5-free" not found in opencode provider
- `pr850`: "kimi-k2.5-free" not found in opencode provider
- `pr780`: "kimi-k2.5-free" not found in opencode provider (v0.16.8)

The `opencode` custom loader filters models: it keeps only free models (cost.input === 0) when no API key is present. At the time of these failures, the bundled data had only 5 models for opencode: `trinity-large-preview-free, glm-5-free, gpt-5-nano, big-pickle, minimax-m2.5-free`.

**Verification**: `kimi-k2.5-free` IS present in the live `models.dev/api.json` with `cost.input === 0`.

### 2. Hard Failure on Unknown Models

When `getModel()` couldn't find a model in the catalog, it threw `ModelNotFoundError` immediately without attempting to use the model via the SDK. Many providers support models not listed in their catalog.

### 3. Plain-Text Error Output from Bun

Bun runtime prints its own error format (source code snippet + stack trace) to stderr when errors propagate through promise chains, even when caught by `.catch()`. This violates the requirement that all output be JSON-parseable.

## Affected Components

| File | Issue |
|------|-------|
| `js/src/provider/provider.ts:getModel()` | Throws on unknown models instead of trying them |
| `js/src/provider/models.ts:ModelsDev.get()` | Cache may be stale, no on-demand refresh |
| `js/src/index.js` | No stderr interception for Bun's plain-text errors |
| `js/src/session/prompt.ts` | Re-throws ModelNotFoundError (becomes unhandled) |

## Solutions Implemented

### Fix 1: Try Unknown Models Instead of Throwing

Changed `getModel()` to create a minimal fallback model info when the model isn't in the catalog. The SDK/provider will reject if the model truly doesn't exist, giving a more accurate error.

### Fix 2: Auto-Refresh Cache on Miss

When a model isn't found in the catalog, `getModel()` now calls `ModelsDev.refresh()` to fetch fresh data from `models.dev` before falling back. This resolves the most common cause: stale cache.

### Fix 3: Stderr JSON Interception

Added a stderr write interceptor that wraps any non-JSON output (like Bun stack traces) in a JSON envelope: `{"type":"error","errorType":"RuntimeError","message":"..."}`.

## Comparison with Reference Codebases

### kilo-Org/kilo
- Uses similar model resolution from `models.dev`
- Our three-tier fallback (catalog → refresh → fallback info) is more robust

### anomalyco/opencode
- Reference implementation for the `opencode` provider
- Uses `@ai-sdk/openai-compatible` package for provider SDK
- Our approach of creating fallback model info aligns with how the SDK handles unknown models

## Test Coverage

Added `js/tests/model-fallback.test.ts`:
- Fallback model info structure validation
- `ModelsDev.refresh()` reliability
- `ModelsDev.get()` data integrity after refresh
- Stderr JSON interception logic

## Lessons Learned

1. **Don't fail on catalog misses**: When the model catalog is a best-effort cache, treat missing entries as "try anyway" not "fail hard"
2. **On-demand cache refresh**: When a specific resource is missing, refresh the cache before giving up
3. **Control all output channels**: Runtime environments (Bun, Node) may write to stderr in their own format; intercept to maintain JSON-only output
4. **Build-time snapshots go stale**: Any data bundled at build time needs a runtime refresh mechanism
