# Case Study: Issue #206 - No debug HTTP requests/responses in --verbose mode

## Issue Summary

When running `agent --model opencode/kimi-k2.5-free --verbose`, the `--verbose` flag enables detailed JSON logging output, but raw HTTP requests and responses to AI model providers are not logged. This makes it impossible to diagnose provider failures — the user can see the model returned zero tokens but cannot see the actual HTTP request/response that caused the failure.

## Evidence

Log file: `solution-draft-log.txt` (2237 lines from gist `a0bb13a57b06e7df16e36caf9093e9e6`)

Key observations from the log:
- Version `0.16.11` was running (which includes the verbose HTTP logging from PR #205/issue #204)
- `getSDK` log messages appear at lines 681 and 700 — confirming the SDK was created
- Model `opencode/kimi-k2.5-free` resolved to `@ai-sdk/openai-compatible` bundled provider
- The model responded with text and tool calls at lines 1970-1976
- **Zero "HTTP request" or "HTTP response" log messages** appear anywhere in the 2237-line log
- Provider returned zero tokens with unknown finish reason at line 1995

## Root Cause Analysis

The verbose HTTP logging code in `js/src/provider/provider.ts` (lines 1204-1388) checked `Flag.OPENCODE_VERBOSE` at **SDK creation time** using a conditional guard:

```typescript
// OLD CODE (buggy)
if (Flag.OPENCODE_VERBOSE) {
  const innerFetch = options['fetch'];
  options['fetch'] = async (...) => { /* logging wrapper */ };
}
```

This created a race condition between:
1. **SDK creation time**: When `getSDK()` creates and caches the provider SDK
2. **Flag initialization time**: When `Flag.setVerbose(true)` is called from the yargs middleware

The SDK cache uses `Bun.hash.xxHash32(JSON.stringify({ pkg, options }))` as the key. Since `JSON.stringify` strips function values, the cache key is the same regardless of whether the verbose wrapper was applied. This means:

- If the SDK is created **before** verbose mode is enabled, the fetch wrapper is never applied
- The cached SDK (without verbose logging) is then reused for all subsequent requests
- Even though `Flag.OPENCODE_VERBOSE` is `true` by the time the actual HTTP request happens, the wrapper was never installed

### Investigation Timeline

1. Verified `Flag.setVerbose(true)` is called in yargs middleware before the command handler
2. Verified the AI SDK properly passes custom `fetch` to `postJsonToApi` (confirmed via experiment `test-verbose-fetch-wrapper.ts`)
3. Verified the fetch wrapping mechanism works correctly via experiment
4. Verified `Flag.OPENCODE_VERBOSE` timing with experiment `test-verbose-flag-timing.ts`
5. Identified that while individual tests pass, the production SDK caching and module loading order may cause the flag check to fail

## Fix

Changed the verbose logging wrapper from a creation-time conditional to a call-time check:

```typescript
// NEW CODE (fixed)
{
  const innerFetch = options['fetch'];
  options['fetch'] = async (input, init) => {
    // Check verbose flag at call time — not at SDK creation time
    if (!Flag.OPENCODE_VERBOSE) {
      return innerFetch(input, init);
    }
    // ... logging logic ...
  };
}
```

Key changes:
- **Always** wrap the fetch function (remove outer `if` guard)
- Check `Flag.OPENCODE_VERBOSE` **inside** the wrapper at call time
- When verbose is disabled, the wrapper is a zero-overhead passthrough (just a boolean check)
- When verbose is enabled (even if it was disabled at SDK creation), logging works correctly

This is robust because:
- No dependency on flag timing vs SDK creation order
- Verbose mode can be toggled dynamically
- Negligible overhead when verbose is disabled (single boolean check per HTTP request)

## Files Changed

- `js/src/provider/provider.ts`: Move verbose flag check from SDK creation time to fetch call time
- `js/tests/verbose-http-logging.test.ts`: Add tests for runtime flag checking behavior
- `js/experiments/test-verbose-fetch-wrapper.ts`: Experiment verifying fetch wrapping works
- `js/experiments/test-verbose-flag-timing.ts`: Experiment verifying flag timing

## Test Coverage

Added 3 new tests in `verbose-http-logging.test.ts`:
1. Verbose wrapper is a no-op when verbose is disabled
2. Verbose wrapper logs when verbose is enabled at call time
3. Verbose flag can change between SDK creation and fetch call
