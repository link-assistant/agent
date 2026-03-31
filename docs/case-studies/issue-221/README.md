# Case Study: Issue #221 — Missing HTTP Request/Response Logs in Verbose Mode

**Issue**: [link-assistant/agent#221](https://github.com/link-assistant/agent/issues/221)
**PR**: [link-assistant/agent#222](https://github.com/link-assistant/agent/pull/222)
**Related**: [#217](https://github.com/link-assistant/agent/issues/217), [#215](https://github.com/link-assistant/agent/issues/215)

## Problem Statement

When running the agent with `--verbose` mode, **zero HTTP request/response logs** appeared
despite the model making **18 successful API calls** during a session. The user expected to
see raw HTTP traffic for debugging but got none.

From the solution draft log (`solution-draft-log.txt`, 8536 lines):
- 18 `step_start` events confirmed the model was actively calling APIs
- Zero `"service": "http"` log entries — no HTTP traffic was logged at all
- The session ran for 104 seconds with the `minimax-m2.5-free` model

## Root Cause Analysis

### The Fetch Chain Architecture

The agent uses a layered fetch chain for provider API calls:

```
SDK call (e.g., generateText)
  → provider-level verbose wrapper (provider.ts)
    → RetryFetch wrapper
      → existingFetch (options.fetch ?? globalThis.fetch)
        → actual network call
```

### The Bug: Conflicting Logging Strategies

Two independent mechanisms existed for HTTP logging:

1. **Global fetch monkey-patch** (`index.js`): Replaced `globalThis.fetch` with a verbose
   wrapper and set `globalThis.__agentVerboseFetchInstalled = true`.

2. **Provider-level verbose wrapper** (`provider.ts`): Wrapped `options.fetch` inside each
   SDK's configuration with verbose logging.

The provider-level wrapper had this condition (line 1233-1237 of `provider.ts`):

```typescript
if (!Flag.OPENCODE_VERBOSE || globalThis.__agentVerboseFetchInstalled) {
  return innerFetch(input, init);  // Skip logging!
}
```

This means: **when the global monkey-patch was installed, the provider wrapper always
skipped logging**, deferring to the global patch.

### Why the Global Patch Failed

The global monkey-patch was unreliable because:

1. **Module-level `fetch` capture**: Some modules (e.g., `claude-oauth.ts` line 28) capture
   `fetch` at import time: `const verboseFetch = createVerboseFetch(fetch, ...)`. This
   captures the *original* `fetch` before the monkey-patch is installed.

2. **AI SDK internal fetch resolution**: The AI SDK (`@ai-sdk/anthropic`, etc.) may resolve
   and cache `fetch` references during provider creation, before the global monkey-patch
   runs in the middleware chain.

3. **Timing dependency**: The monkey-patch runs in yargs middleware (async), but module
   imports and SDK initialization may happen before middleware executes.

### The Result

- Global monkey-patch → installed (sets `__agentVerboseFetchInstalled = true`)
- Provider wrapper → sees `__agentVerboseFetchInstalled`, skips logging
- AI SDK internal fetch → does NOT go through `globalThis.fetch` monkey-patch
- **Net effect: zero HTTP logs**

## Fix

### 1. Removed Global Fetch Monkey-Patch (`index.js`)

Deleted the `globalThis.fetch` reassignment and `__agentVerboseFetchInstalled` flag.
The global approach was fundamentally unreliable due to timing issues.

### 2. Fixed Provider-Level Wrapper (`provider.ts`)

Removed the `globalThis.__agentVerboseFetchInstalled` skip condition:

```typescript
// BEFORE (buggy):
if (!Flag.OPENCODE_VERBOSE || globalThis.__agentVerboseFetchInstalled) {
  return innerFetch(input, init);
}

// AFTER (fixed):
if (!Flag.OPENCODE_VERBOSE) {
  return innerFetch(input, init);
}
```

The provider-level wrapper is now the **sole mechanism** for logging HTTP traffic to LLM
providers. This works reliably because:

- The wrapper is injected directly into `options.fetch` passed to each SDK
- It is part of the fetch chain that the SDK *actually uses*
- It checks `Flag.OPENCODE_VERBOSE` at call time (live ESM binding), not creation time

### 3. Non-Provider HTTP Calls

Other HTTP calls (auth, tools, config) already use their own `createVerboseFetch` instances
and were not affected by this bug. For example:
- `claude-oauth.ts`: `createVerboseFetch(fetch, { caller: 'claude-oauth' })`
- `webfetch.ts`: `createVerboseFetch(fetch, { caller: 'webfetch' })`

## Secondary Issue: Compaction Model

The issue also asked why the compaction model differs from `--model`. This is expected
behavior — the default compaction model is `opencode/gpt-5-nano` (configured in
`cli/defaults.ts` line 24), intentionally different from the main conversation model.
The "same model" log message refers to session summarization, not compaction.

## Verification

- **Unit tests**: 4 new tests in `js/tests/provider-verbose-logging.test.ts`
  - Provider wrapper logs when verbose is enabled
  - Provider wrapper does NOT log when verbose is disabled
  - Provider wrapper checks verbose at call time, not creation time
  - Provider wrapper does NOT depend on global fetch monkey-patch
- **Experiment scripts**: In `js/experiments/` confirming SDK fetch passthrough and chain behavior
- **All 307 existing tests pass** across 15 test files

## Lessons Learned

1. **Global monkey-patching is fragile**: When multiple modules capture references to
   globals at import time, monkey-patching after the fact is unreliable.

2. **Don't defer to unreliable mechanisms**: The provider wrapper was correct but deferred
   to the global patch. It should have been the primary mechanism from the start.

3. **Two logging paths = zero logging**: Having two mechanisms that disable each other
   created a situation where neither actually logged anything.

## Files in This Case Study

- `README.md` — This analysis document
- `solution-draft-log.txt` — Full log from the failed verbose session (8536 lines)
