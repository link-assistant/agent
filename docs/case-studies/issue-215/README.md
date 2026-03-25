# Case Study: Issue #215 — No Raw HTTP Requests/Responses Logged in `--verbose` Mode

## Summary

The agent was run with `--verbose` flag but the logs contained no raw HTTP request/response entries, making it impossible to debug a "socket connection closed unexpectedly" error that caused the agent to fail.

## Timeline of Events

Based on the log file at `data/solve-log.txt`:

| Time (UTC) | Event | Details |
|---|---|---|
| 10:12:12.363 | solve.mjs starts | v1.35.9, with `--verbose --attach-logs` flags |
| 10:12:46.040 | Agent command launched | `agent --model opencode/minimax-m2.5-free --verbose` |
| 10:12:46.772 | Agent starts | v0.16.17, continuous stdin mode, verbose enabled |
| 10:12:46.809 | Provider state init | Loads opencode, kilo, claude-oauth providers |
| 10:12:47.022 | getSDK called | Uses `@ai-sdk/anthropic` bundled provider |
| 10:12:47.023 | Model resolved | `opencode/minimax-m2.5-free` found |
| 10:12:48.989 | First step_start | LLM call begins (first API request made here) |
| 10:12:50.481 | First stream chunk | Response streaming starts (~1.5s after step_start) |
| 10:12:52.090 | First tool_use | Agent starts executing bash commands |
| ... | Multiple LLM steps | Agent works on the issue, making multiple API calls |
| 10:21:18.977 | **Socket error** | "The socket connection was closed unexpectedly" |
| 10:22:40.252 | Abort event | Session processor aborts |
| ... | Agent continues | Eventually recovers and continues work |
| 10:29:19.771 | **Fatal error** | Second socket close error, this time unhandled |
| 10:29:19.861 | Agent terminates | solve.mjs detects error in output |

## Root Cause Analysis

### Finding 1: Verbose HTTP logging code IS present in v0.16.17

The verbose HTTP logging wrapper was added in commit `1b70348` as part of issue #211 and is included in the 0.16.17 release. The code at `js/src/provider/provider.ts` lines 1204-1403 wraps the SDK's `fetch` function and logs HTTP requests/responses when `Flag.OPENCODE_VERBOSE` is true.

### Finding 2: The logging infrastructure works correctly

Experiments confirm that:
- `Flag.OPENCODE_VERBOSE` is correctly set to `true` by the middleware
- `Log.init()` is called before the handler runs
- The `write` function is properly initialized to output to stdout
- The provider logger (created at module level) correctly uses the updated `write` function
- Both server mode and direct mode produce HTTP log entries

### Finding 3: Missing diagnostic breadcrumbs

The verbose HTTP logging wrapper has no diagnostic log at initialization time. There is no log entry confirming that the fetch wrapper was applied to a specific provider/SDK. This makes it impossible to determine from logs alone whether:
- The wrapper was applied
- The wrapper was bypassed due to caching
- The wrapper was applied but the `Flag.OPENCODE_VERBOSE` check returned false at call time

### Finding 4: Bun socket errors lack context

The error "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()" is a known Bun issue (see [oven-sh/bun#9881](https://github.com/oven-sh/bun/issues/9881), [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439)). Bun's `fetch()` accepts a non-standard `verbose: true` option that prints request/response headers to the terminal for debugging. The agent's verbose fetch wrapper does NOT pass this option.

### Finding 5: Error path may not produce HTTP logs

When a socket error occurs during `fetch()`, the error is caught at line 1386 in the verbose wrapper:
```typescript
} catch (error) {
    log.error('HTTP request failed', { ... });
    throw error;
}
```

However, if the error occurs at the Bun internal level before `fetch()` returns, or if the error is thrown asynchronously from the stream processing, the verbose wrapper's catch block may not capture it. The error message in the log suggests it was caught by the session event handler, not by the verbose wrapper.

### Finding 6: Possible version mismatch

The log shows version 0.16.17 but the actual globally-installed agent binary may have been a different build. The solve.mjs tool installs the agent via npm/bun and uses the globally installed version. If the installation cache was stale, the running binary may not have included the verbose HTTP logging fix from issue #211.

## Implemented Solutions

### Solution 1: Log at SDK creation time (not just first call)

Added a `log.info('verbose HTTP fetch wrapper installed', ...)` entry at SDK creation time that confirms the wrapper is in the fetch chain. This fires regardless of whether verbose is enabled — providing a clear diagnostic breadcrumb.

### Solution 2: Redundant stderr diagnostic channel

Added `process.stderr.write()` as a redundant output channel for the "verbose HTTP logging active" breadcrumb. If stdout JSON is being filtered/dropped by an external wrapper (solve.mjs), the stderr message still appears. This bypasses the entire JSON logging pipeline.

### Solution 3: Try/catch around request preparation

Wrapped the header sanitization and body preview preparation in `try/catch` so that any error in logging preparation does NOT break the actual HTTP request. Previously, if header iteration threw, the entire fetch call would fail.

### Solution 4: HTTP call numbering

Added sequential `callNum` to each HTTP request/response log entry for correlation. This makes it easy to match request/response pairs in logs even when multiple concurrent calls are in flight.

### Solution 5: Pass Bun's `verbose: true` to fetch (from previous iteration)

Already implemented: when `Flag.OPENCODE_VERBOSE` is true, passes `verbose: true` in the fetch init options. This enables Bun's built-in connection debugging on socket errors.

### Solution 6: Enhanced error logging (from previous iteration)

Already implemented: includes `error.stack` and `error.cause` in the "HTTP request failed" log entry.

## Related Issues & References

- [Issue #211](https://github.com/link-assistant/agent/issues/211) — Fixed lazy logging for HTTP verbose output
- [Issue #200](https://github.com/link-assistant/agent/issues/200) — Original verbose mode request
- [Issue #206](https://github.com/link-assistant/agent/issues/206) — Flag checked at call time, not SDK creation time
- [oven-sh/bun#9881](https://github.com/oven-sh/bun/issues/9881) — Bun socket connection closed unexpectedly
- [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439) — ConnectionClosed when fetching for >10s
- [oven-sh/bun#5363](https://github.com/oven-sh/bun/issues/5363) — Dev server fetch ConnectionClosed
