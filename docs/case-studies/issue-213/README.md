# Case Study: Agent Process Leaks (#213)

## Issue

After working on PR #212 (HTTP verbose logging and anthropic usage fix), the Hive Mind
system reported an abnormal accumulation of agent processes:

```
Queues
claude (pending: 1, processing: 3)
agent (pending: 0, processing: 52)
```

Over 50 agent processes were running simultaneously, many orphaned (PPID=1), consuming
system resources. The processes were spawned by Bun test runner but never exited.

## Timeline

1. PR #212 introduced test changes that exercised the agent CLI via `sh()` and `spawn()`
2. Tests spawned child processes running `bun run src/index.js`
3. Child processes hit rate limits (API model: `opencode/minimax-m2.5-free`)
4. Rate limit retry mechanism kept processes alive (up to 7-day retry timeout)
5. Test runner either timed out or moved on, but child processes continued running
6. Orphaned processes accumulated with PPID=1

## Root Causes

### 1. No Process Lifetime Guard

The agent had no maximum lifetime. When the retry mechanism activated (default: 7-day
timeout via `AGENT_RETRY_TIMEOUT`), processes would stay alive indefinitely. Even after
the parent test process exited, child processes continued retrying.

**Evidence**: Process `PID 1078108` was running for 58+ minutes with the same batch
test command, stuck in the retry loop.

### 2. Event Loop Kept Alive by `setTimeout` Without `.unref()`

In `continuous-mode.js`, the `waitForPending()` function uses recursive `setTimeout`
to poll for completion:

```javascript
// BEFORE (bug): setTimeout keeps event loop alive
const waitForPending = () => {
  if (!isProcessing && pendingMessages.length === 0) {
    resolve();
  } else {
    setTimeout(waitForPending, 100); // No .unref()!
  }
};
```

Without `.unref()`, this timer prevented the process from exiting naturally even when
all other work was done.

### 3. SIGINT Handler Accumulation

`process.on('SIGINT', ...)` was used instead of `process.once('SIGINT', ...)`. Each
time the continuous mode was entered, a new SIGINT handler was added without removing
old ones:

```javascript
// BEFORE (bug): Handlers accumulate
process.on('SIGINT', () => { ... });

// AFTER (fix): Single handler, auto-removed
process.once('SIGINT', sigintHandler);
```

### 4. Missing Error Listener Cleanup in `input-queue.js`

The `stop()` method removed `data` and `end` listeners but forgot the `error` listener:

```javascript
// BEFORE (bug): error handler not removed
stop: () => {
  process.stdin.removeListener('data', handleData);
  process.stdin.removeListener('end', handleEnd);
  // Missing: removeListener('error', ...)
}
```

### 5. `Bun.serve()` With `idleTimeout: 0` Keeps Event Loop Alive

The HTTP server created by `Server.listen()` uses `idleTimeout: 0` (infinite), which
keeps connections open indefinitely. Even after `server.stop()`, active connections may
not be fully cleaned up, keeping the event loop alive.

## Fixes Applied

### Fix 1: Process Lifetime Watchdog (`index.js`)

Added `AGENT_PROCESS_LIFETIME_TIMEOUT` environment variable that sets a maximum process
lifetime in seconds. When exceeded, the process force-exits with code 2. The timer uses
`.unref()` so it doesn't prevent normal exit.

```bash
# Usage: Set maximum lifetime to 30 minutes
AGENT_PROCESS_LIFETIME_TIMEOUT=1800 bun run src/index.js
```

### Fix 2: `setTimeout.unref()` in `waitForPending` (`continuous-mode.js`)

Added `.unref()` to the recursive `setTimeout` in both `runContinuousServerMode` and
`runContinuousDirectMode` to prevent keeping the event loop alive.

### Fix 3: `process.once('SIGINT')` (`continuous-mode.js`)

Changed from `process.on('SIGINT', ...)` to `process.once('SIGINT', ...)` to prevent
handler accumulation. Added `safeResolve` guard against double-resolution.

### Fix 4: Error Listener Cleanup (`input-queue.js`)

Named the anonymous error handler so it can be properly removed in `stop()`.

### Fix 5: Exit Logging (`index.js`)

Added verbose logging at process exit to track uptime and error state.

## Related Issues

- [oven-sh/bun#13887](https://github.com/oven-sh/bun/issues/13887) - Bun process not
  terminated automatically (event loop stays alive after work completes)
- [oven-sh/bun#11892](https://github.com/oven-sh/bun/issues/11892) - Spawned child
  process not killed on GitHub Actions
- [oven-sh/bun#19563](https://github.com/oven-sh/bun/issues/19563) - Bun hangs on
  closed express server (event loop not exiting)

## Process Snapshot

See `process-snapshot.txt` for the actual process tree captured during investigation.

## Recommendations

1. **Always set `AGENT_PROCESS_LIFETIME_TIMEOUT`** when running tests to prevent
   process accumulation. Recommended value: `300` (5 minutes) for tests.

2. **Consider reducing `AGENT_RETRY_TIMEOUT`** for test environments. The default
   7-day timeout is appropriate for production but too long for CI/CD.

3. **Use `--no-server` mode** when possible to avoid `Bun.serve()` keeping the event
   loop alive.

4. **Add `afterAll()` hooks** in test files that spawn child processes to ensure
   cleanup on test failure/timeout.
