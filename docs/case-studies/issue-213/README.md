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

### 1. Event Loop Kept Alive by `setTimeout`/`setInterval` Without `.unref()`

Multiple timers across the codebase prevented the Node.js/Bun event loop from exiting
naturally when all work was complete:

- `continuous-mode.js`: `waitForPending()` uses recursive `setTimeout` without `.unref()`
- `retry-fetch.ts`: `createIsolatedRateLimitSignal()` creates timers without `.unref()`
- `session/retry.ts`: `sleep()` function uses `setTimeout` without `.unref()`
- `util/timeout.ts`: `withTimeout()` utility uses `setTimeout` without `.unref()`

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

Without `.unref()`, these timers prevented the process from exiting naturally even when
all other work was done.

### 2. SIGINT Handler Accumulation

`process.on('SIGINT', ...)` was used instead of `process.once('SIGINT', ...)`. Each
time the continuous mode was entered, a new SIGINT handler was added without removing
old ones:

```javascript
// BEFORE (bug): Handlers accumulate
process.on('SIGINT', () => { ... });

// AFTER (fix): Single handler, auto-removed
process.once('SIGINT', sigintHandler);
```

### 3. Missing Error Listener Cleanup in `input-queue.js`

The `stop()` method removed `data` and `end` listeners but forgot the `error` listener:

```javascript
// BEFORE (bug): error handler not removed
stop: () => {
  process.stdin.removeListener('data', handleData);
  process.stdin.removeListener('end', handleEnd);
  // Missing: removeListener('error', ...)
}
```

### 4. `Bun.serve()` With `idleTimeout: 0` Keeps Event Loop Alive

The HTTP server created by `Server.listen()` uses `idleTimeout: 0` (infinite), which
keeps connections open indefinitely. Even after `server.stop()`, active connections may
not be fully cleaned up, keeping the event loop alive.

## Fixes Applied

### Fix 1: `.unref()` on All Timer-Based Sleeps and Waits

Added `.unref()` to timers in:
- `retry-fetch.ts`: sleep(), createIsolatedRateLimitSignal() timers
- `session/retry.ts`: sleep() timer
- `util/timeout.ts`: withTimeout() timer
- `continuous-mode.js`: waitForPending() and checkRunning interval

This ensures timers don't prevent the event loop from exiting when all work is done.

### Fix 2: `Bun.serve()` `idleTimeout` Changed from 0 to 255 (`server.ts`)

Changed from `idleTimeout: 0` (infinite) to `idleTimeout: 255` (default, ~4 minutes)
to prevent keeping the event loop alive via idle HTTP connections.

### Fix 3: `process.once('SIGINT')` (`continuous-mode.js`)

Changed from `process.on('SIGINT', ...)` to `process.once('SIGINT', ...)` to prevent
handler accumulation. Added `safeResolve` guard against double-resolution.

### Fix 4: Error Listener Cleanup (`input-queue.js`)

Named the anonymous error handler so it can be properly removed in `stop()`.

### Fix 5: ESLint Rules for Leak Prevention

Added `eslint-plugin-promise` with rules:
- `promise/catch-or-return`: Detects dangling/floating promises
- `promise/no-nesting`: Warns about nested promise anti-patterns
- Custom `no-restricted-syntax` rules warning against `process.on('SIGINT'/'SIGTERM')`

### Fix 6: Exit Logging (`index.js`)

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

1. **Always use `.unref()`** on timers that are only needed as a safety net
   (timeouts, retries, polling). This ensures the event loop can exit naturally.

2. **Consider reducing `AGENT_RETRY_TIMEOUT`** for test environments. The default
   7-day timeout is appropriate for production but too long for CI/CD.

3. **Use `--no-server` mode** when possible to avoid `Bun.serve()` keeping the event
   loop alive.

4. **Add `afterAll()` hooks** in test files that spawn child processes to ensure
   cleanup on test failure/timeout.

5. **Use `eslint-plugin-promise`** to detect dangling promises at lint time.
