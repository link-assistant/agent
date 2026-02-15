# Case Study: Issue #183 - Operation Timed Out While Waiting for Rate Limit Reset

## Summary

The agent fails with `"The operation timed out."` error after exactly 5 minutes, even though the rate limit retry logic correctly detected a long retry-after period (~15.2 hours) and intended to wait. The timeout occurs because **competing abort signals** from the provider's fetch wrapper and/or external process supervisors terminate the operation before the rate limit wait completes.

## Issue Details

- **Issue URL**: https://github.com/link-assistant/agent/issues/183
- **Reporter**: konard
- **Date**: 2026-02-15
- **Agent Version**: 0.13.2
- **Related Issues**: #167 (retry logic), #142 (timeout retries), #157 (rate limit handling)
- **Severity**: High -- Agent cannot complete long rate-limited operations

## Timeline of Events

| Timestamp (UTC) | Event | Details |
|-----------------|-------|---------|
| 2026-02-15T08:45:53.309Z | Session started | `ripgrep tree` operation |
| 2026-02-15T08:45:53.346Z | Processor started | `session.processor process` |
| 2026-02-15T08:45:53.682Z | Rate limit detected | API returned `retry-after: 54847` seconds (~15.24 hours) |
| 2026-02-15T08:45:53.682Z | Retry scheduled | `delay: 55763274` ms (~15.49 hours with jitter) |
| 2026-02-15T08:45:53.682Z | Message logged | "rate limited, will retry" |
| 2026-02-15T08:45:53.765Z | Second rate limit | Similar values, parallel request |
| 2026-02-15T08:50:53.193Z | **ERROR** | "The operation timed out." |

**Key Observation**: The error occurred exactly **299.884 seconds (5.00 minutes)** after the session started, despite the retry logic intending to wait ~15.5 hours.

## Root Cause Analysis

### Primary Cause: Competing Abort Signals

The `retry-fetch.ts` module correctly parses the `retry-after` header and calls `sleep()` to wait. However, this sleep is subject to an **AbortSignal** that can be triggered by:

1. **Provider timeout configuration** (default: 300,000ms = 5 minutes)
2. **Stream step timeout** (default: 600,000ms = 10 minutes)
3. **Stream chunk timeout** (default: 120,000ms = 2 minutes)
4. **External process supervisors** (CI/CD timeouts, etc.)

```typescript
// In retry-fetch.ts:154-167
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));  // ← This fires!
      }, { once: true });
    }
  });
}
```

### Signal Chain

```
User Request → streamText() → fetch() wrapper → retry-fetch → sleep(15.5 hours)
                    ↓                ↓
            step timeout (10m)   provider timeout (5m) ← Fires first!
                    ↓
                AbortSignal fires → DOMException: 'TimeoutError'
                    ↓
                "The operation timed out."
```

### Why 5 Minutes?

The 5-minute timeout likely comes from:

1. **Provider timeout**: Documentation mentions 300,000ms (5 minutes) as the default
2. **External supervisor**: The solve process or CI system may have a 5-minute timeout

From `js/src/config/config.ts:853`:
```typescript
// Timeout in milliseconds for requests to this provider.
// Default is 300000 (5 minutes). Set to false to disable timeout.
```

### Contributing Factors

1. **Rate limit response**: API returned a 15.2-hour retry-after period
2. **Timeout hierarchy**: Provider/stream timeouts are not suspended during rate limit waits
3. **Signal propagation**: The retry-fetch sleep shares the same abort signal chain
4. **No timeout awareness**: The retry logic doesn't disable or extend competing timeouts

## Detailed Log Analysis

### Rate Limit Detection (Correct)

```json
{
  "type": "log",
  "timestamp": "2026-02-15T08:45:53.682Z",
  "service": "retry-fetch",
  "headerValue": 54847,
  "delayMs": 54847000,
  "message": "parsed retry-after header (seconds)"
}
```

The retry-fetch correctly parsed the 54,847 second (~15.24 hours) retry-after value.

### Retry Scheduled (Correct)

```json
{
  "type": "log",
  "timestamp": "2026-02-15T08:45:53.682Z",
  "service": "retry-fetch",
  "sessionID": "opencode",
  "attempt": 1,
  "delay": 55763274,
  "delayMinutes": "929.39",
  "elapsed": 313,
  "remainingTimeout": 604799687,
  "message": "rate limited, will retry"
}
```

The calculated delay with jitter was ~929 minutes (~15.49 hours). The `remainingTimeout` of ~604 million ms (~7 days) shows the global `AGENT_RETRY_TIMEOUT` is correctly configured.

### Timeout Error (The Problem)

```json
{
  "type": "error",
  "timestamp": 1771145453193,
  "sessionID": "ses_39f85b550ffe7GaNPe7osuiGuW",
  "error": "The operation timed out."
}
```

This error occurred exactly 5 minutes after session start, indicating an external timeout terminated the operation.

## Impact Assessment

### Severity: High

- **Long rate limit waits are impossible**: Any retry-after > timeout limit will fail
- **Lost work**: Setup time (PR creation, branch creation) is wasted
- **No recovery**: User must manually retry after rate limit expires
- **Configuration confusion**: Users expect `AGENT_RETRY_TIMEOUT` to govern all waits

### Affected Configurations

The issue affects any scenario where:
- `retry-after` > provider timeout (default 5 minutes)
- `retry-after` > stream step timeout (default 10 minutes)
- `retry-after` > external process supervisor timeout

## Proposed Solutions

### Solution 1: Disable Timeouts During Rate Limit Wait (Recommended)

When the retry-fetch module enters a rate limit wait, it should:
1. Not inherit the abort signal from the parent request
2. Create an isolated sleep that only respects the global `AGENT_RETRY_TIMEOUT`

**Implementation**:

```typescript
// In retry-fetch.ts, modify the sleep call during rate limit handling
// Don't pass the request's AbortSignal to the sleep function
// Instead, create a new timeout based on AGENT_RETRY_TIMEOUT

export function create(options: RetryFetchOptions = {}): typeof fetch {
  // ...
  return async function retryFetch(input, init) {
    // ...
    // Create a dedicated AbortController for rate limit waits
    const rateLimitAbort = new AbortController();
    const globalTimeout = setTimeout(() => {
      rateLimitAbort.abort();
    }, Flag.RETRY_TIMEOUT() * 1000);

    try {
      await sleep(delay, rateLimitAbort.signal);  // Use isolated signal
    } finally {
      clearTimeout(globalTimeout);
    }
    // ...
  };
}
```

**Pros**:
- Allows long rate limit waits up to `AGENT_RETRY_TIMEOUT`
- Doesn't break existing timeout behavior for normal requests
- Minimal code changes

**Cons**:
- Requires careful signal management
- Need to handle cleanup on process termination

### Solution 2: Extend Provider Timeout During Rate Limit

Dynamically extend the provider timeout when a rate limit is detected:

```typescript
// When rate limit detected with retry-after > current timeout
if (retryAfterMs > remainingProviderTimeout) {
  // Extend the provider timeout to accommodate the wait
  extendProviderTimeout(retryAfterMs + 30000);  // Add 30s buffer
}
```

**Pros**:
- Works within existing timeout architecture
- Transparent to higher-level code

**Cons**:
- Complex to implement
- May affect other timeout-related behavior

### Solution 3: Background Rate Limit Queue

Move rate-limited requests to a background queue that's not subject to request timeouts:

```typescript
// When rate limit detected with long retry-after
if (retryAfterMs > 60000) {  // More than 1 minute
  // Queue for background retry
  await RateLimitQueue.schedule({
    request: { input, init },
    retryAt: Date.now() + retryAfterMs,
    sessionID,
  });
  // Return a "queued" status to caller
  return new Response(JSON.stringify({
    status: 'queued',
    retryAt: Date.now() + retryAfterMs,
  }), { status: 202 });
}
```

**Pros**:
- Clean separation of concerns
- Can handle multiple rate-limited requests efficiently
- User can be notified and continue other work

**Cons**:
- Significant architecture change
- Requires persistent queue storage
- Complex state management

### Solution 4: Configurable Rate Limit Handling

Add configuration option to specify rate limit handling strategy:

```typescript
// In config
provider: {
  opencode: {
    options: {
      timeout: 300000,  // Normal request timeout
      rateLimitTimeout: false,  // Disable timeout during rate limit wait
      // OR: rateLimitTimeout: 86400000,  // 24 hour max wait
    }
  }
}
```

**Pros**:
- User-configurable behavior
- Can be tuned per-provider

**Cons**:
- More configuration complexity
- Documentation overhead

## Related Issues and External Resources

### Agent Issues
- [#167](https://github.com/link-assistant/agent/issues/167) - Retry Logic Should Use Global Timeout Instead of Retry Count
- [#142](https://github.com/link-assistant/agent/issues/142) - Automatic Retry on Timeout Errors
- [#157](https://github.com/link-assistant/agent/issues/157) - Rate limit handling improvements
- [#146](https://github.com/link-assistant/agent/issues/146) - Stream timeout configuration

### Vercel AI SDK Issues
- [vercel/ai#7247](https://github.com/vercel/ai/issues/7247) - SDK does not respect rate limit headers from API providers
- [vercel/ai#4842](https://github.com/vercel/ai/issues/4842) - Implement Custom Retry Callback for Error-Specific Retries

### Bun Issues
- [oven-sh/bun#13302](https://github.com/oven-sh/bun/issues/13302) - AbortSignal.timeout and fetch not working when can't reach server
- [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439) - Known 10-second idle timeout issue

### Documentation
- [MDN AbortSignal.timeout()](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Vercel AI SDK Timeout Configuration](https://ai-sdk.dev/docs/troubleshooting/timeout-on-vercel)
- [Vercel AI SDK Rate Limiting](https://ai-sdk.dev/docs/advanced/rate-limiting)

## Existing Libraries for Rate Limit Handling

| Library | Description | Relevance |
|---------|-------------|-----------|
| [p-retry](https://www.npmjs.com/package/p-retry) | Promise-based retry with exponential backoff | Could replace custom retry logic |
| [async-retry](https://www.npmjs.com/package/async-retry) | Async/await retry with configurable delays | Alternative retry implementation |
| [bottleneck](https://www.npmjs.com/package/bottleneck) | Distributed rate limiter | Could implement Solution 3 |
| [p-queue](https://www.npmjs.com/package/p-queue) | Promise queue with concurrency control | Could implement Solution 3 |
| [got](https://www.npmjs.com/package/got) | HTTP client with built-in retry-after support | Reference implementation |

## Configuration Reference

### Current Agent Configuration

| Parameter | Environment Variable | Default | Description |
|-----------|---------------------|---------|-------------|
| Retry Timeout | `AGENT_RETRY_TIMEOUT` | 604800 (7 days) | Total time to retry same error type |
| Max Retry Delay | `AGENT_MAX_RETRY_DELAY` | 1200 (20 min) | Max single retry wait |
| Min Retry Interval | `AGENT_MIN_RETRY_INTERVAL` | 30 (30 sec) | Min time between retries |
| Stream Chunk Timeout | `AGENT_STREAM_CHUNK_TIMEOUT_MS` | 120000 (2 min) | Timeout between stream chunks |
| Stream Step Timeout | `AGENT_STREAM_STEP_TIMEOUT_MS` | 600000 (10 min) | Timeout for each LLM step |
| Provider Timeout | (config) | 300000 (5 min) | Request timeout per provider |

### Competing Timeout Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    Timeout Hierarchy                            │
├─────────────────────────────────────────────────────────────────┤
│  AGENT_RETRY_TIMEOUT (7 days)     ← Global, respects retry-after│
│      │                                                          │
│      ├── Provider Timeout (5 min)  ← Fires during rate limit!  │
│      │                                                          │
│      ├── Stream Step Timeout (10 min)                           │
│      │                                                          │
│      └── Stream Chunk Timeout (2 min)                           │
│                                                                 │
│  Problem: Lower-level timeouts fire before rate limit completes │
└─────────────────────────────────────────────────────────────────┘
```

## Recommendations

### Immediate Fix

1. **Disable provider timeout during rate limit waits**: Modify `retry-fetch.ts` to not inherit the request's abort signal during rate limit sleep

### Short-Term

2. **Add rate limit timeout configuration**: Allow users to set `rateLimitTimeout: false` to disable timeouts during rate limit handling

### Long-Term

3. **Implement background rate limit queue**: For very long waits (>1 hour), queue requests and notify user of scheduled retry time

## Conclusion

Issue #183 occurs because the agent's rate limit retry logic correctly detects and respects long `retry-after` periods, but competing timeout signals (primarily the provider timeout at 5 minutes) abort the wait before the rate limit expires. The solution requires isolating rate limit waits from request-level timeouts, either by not inheriting the abort signal or by dynamically extending timeouts when rate limits are detected.

The fundamental conflict is between:
- **Request timeouts**: Designed to prevent hanging on unresponsive servers
- **Rate limit waits**: Designed to respect server-mandated delays

These two mechanisms serve different purposes and should not share the same abort signal chain when rate limit handling is active.

## Files Changed

This case study documents the issue but does not include a fix implementation. See the proposed solutions above for implementation guidance.

## Data Files

- [`original-log.txt`](./original-log.txt) - Original issue log data
