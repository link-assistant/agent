# Timeout Hierarchy Documentation

This document describes the complete timeout hierarchy in the Link Assistant Agent, including how timeouts interact during rate limit handling and the best practices implemented based on research of similar projects.

## Overview

The agent implements a multi-layer timeout architecture to handle various failure modes:
- Network timeouts (connection failures)
- Provider timeouts (API response delays)
- Stream timeouts (stalled data transfer)
- Rate limit waits (server-mandated delays)

## Timeout Hierarchy Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GLOBAL RETRY TIMEOUT                             │
│                    AGENT_RETRY_TIMEOUT (7 days)                         │
│   Purpose: Maximum time to keep retrying the same error type            │
│   Scope: Per-session, per-error-type tracking                           │
│   Resets: When error type changes                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              RATE LIMIT WAIT (isolated from below)              │   │
│   │   Duration: Server's retry-after value (can be hours)           │   │
│   │   Signal: Dedicated AbortController (since fix for #183)        │   │
│   │   Respects: Only AGENT_RETRY_TIMEOUT                            │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              PROVIDER TIMEOUT (per-request)                     │   │
│   │   Config: provider.options.timeout                              │   │
│   │   Default: 300,000ms (5 minutes)                                │   │
│   │   Scope: Individual HTTP request to AI provider                 │   │
│   │   NOT applied during: Rate limit waits (since #183 fix)         │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              STREAM STEP TIMEOUT                                │   │
│   │   Env: AGENT_STREAM_STEP_TIMEOUT_MS                             │   │
│   │   Default: 600,000ms (10 minutes)                               │   │
│   │   Scope: Each individual LLM generation step                    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │              STREAM CHUNK TIMEOUT                               │   │
│   │   Env: AGENT_STREAM_CHUNK_TIMEOUT_MS                            │   │
│   │   Default: 120,000ms (2 minutes)                                │   │
│   │   Scope: Time between consecutive stream chunks                 │   │
│   │   Purpose: Detect stalled/hanging connections                   │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Configuration Reference

### Environment Variables

| Variable | Default | Unit | Description |
|----------|---------|------|-------------|
| `AGENT_RETRY_TIMEOUT` | 604800 | seconds | Global max time to retry same error type (7 days) |
| `AGENT_MAX_RETRY_DELAY` | 1200 | seconds | Max single retry wait when no retry-after header (20 min) |
| `AGENT_MIN_RETRY_INTERVAL` | 30 | seconds | Minimum time between retry attempts (30 sec) |
| `AGENT_STREAM_CHUNK_TIMEOUT_MS` | 120000 | ms | Timeout between stream chunks (2 min) |
| `AGENT_STREAM_STEP_TIMEOUT_MS` | 600000 | ms | Timeout for each LLM step (10 min) |

### Provider Configuration

```typescript
// In config file
provider: {
  "openai": {
    options: {
      timeout: 300000,  // 5 minutes (default)
      // Set to false to disable provider timeout
    }
  }
}
```

## Timeout Behavior by Error Type

### 1. Rate Limit Errors (HTTP 429)

When a rate limit is detected:

1. **Header Parsing**: Check for `retry-after` or `retry-after-ms` headers
2. **Validation**: Compare retry-after against `AGENT_RETRY_TIMEOUT`
   - If `retry-after > AGENT_RETRY_TIMEOUT`: Fail immediately with `RetryTimeoutExceededError`
   - If `retry-after <= AGENT_RETRY_TIMEOUT`: Wait for the specified duration
3. **Signal Isolation**: Rate limit waits use a dedicated AbortController that only respects the global retry timeout, NOT provider/stream timeouts
4. **Jitter**: 0-10% random variation added to prevent thundering herd

```
Rate Limit Flow:
HTTP 429 → Parse retry-after → Validate against RETRY_TIMEOUT
    │
    ├── Exceeds RETRY_TIMEOUT? → RetryTimeoutExceededError (fail immediately)
    │
    └── Within RETRY_TIMEOUT? → Create isolated AbortController
                                     │
                                     └── sleep(retry-after) → Retry request
```

### 2. Network Errors (Socket/Connection)

Network errors (ECONNRESET, ECONNREFUSED, ConnectionClosed) use:
- **Max attempts**: 3
- **Backoff**: Exponential (1s → 2s → 4s)
- **Signal**: Inherits request AbortSignal

### 3. Timeout Errors (Request Timeout)

When requests timeout:
- **Max attempts**: 3
- **Delays**: Fixed intervals (30s → 60s → 120s)
- **Signal**: Inherits request AbortSignal

## Signal Chain Architecture

### Before Fix (Issue #183)

```
User Request
    │
    ▼
streamText() ──────────────► fetch() wrapper ──────► retry-fetch
    │                              │                      │
    │                              │                      ▼
    ├── step timeout (10m)         │                 sleep(15h)
    │                              │                      │
    └── Provider timeout (5m) ─────┴──────────────────────┘
                                                          │
                                          AbortSignal fires @ 5 min!
                                                          │
                                                          ▼
                                               "The operation timed out."
```

### After Fix (Issue #183)

```
User Request
    │
    ▼
streamText() ──────────────► fetch() wrapper ──────► retry-fetch
    │                              │                      │
    │                              │                      ▼
    ├── step timeout (10m)         │              Rate limit detected?
    │                              │                      │
    └── Provider timeout (5m) ─────┘               Yes ───┤
                                                          │
                                                          ▼
                                              Create ISOLATED AbortController
                                              (only respects RETRY_TIMEOUT)
                                                          │
                                                          ▼
                                                   sleep(15h) OK!
                                                          │
                                                          ▼
                                                   Retry request
```

## Best Practices (Based on Research)

Based on analysis of similar projects (OpenCode, Gemini CLI, Qwen Code, OpenAI Codex):

### 1. Separate Rate Limit Waits from Request Timeouts

**Problem**: Rate limit waits (potentially hours) should not be subject to request-level timeouts (minutes).

**Solution**: Use isolated AbortControllers for rate limit waits that only respect the global retry timeout.

### 2. Respect Server-Provided Retry-After

**Problem**: Guessing retry delays leads to either too-frequent retries (hammering the API) or unnecessarily long waits.

**Solution**: Always use the `retry-after` header value when provided. Only fall back to exponential backoff when no header is present.

### 3. Add Jitter to Prevent Thundering Herd

**Problem**: Multiple clients retrying at exactly the same time can overload servers.

**Solution**: Add ±10% random jitter to all retry delays.

### 4. Distinguish Quota vs. Throttling

**Problem**: Daily quota exhaustion requires different handling than per-minute rate limits.

**Solution**:
- Terminal quota errors (daily limits): Don't retry, inform user
- Transient rate limits (per-minute): Retry with server's delay

### 5. Provide User Feedback During Long Waits

**Problem**: Users need to know what's happening during long rate limit waits.

**Solution**: Update session status with retry information including next retry time.

## Related Issues

- [#183](https://github.com/link-assistant/agent/issues/183) - Timeout during rate limit wait
- [#167](https://github.com/link-assistant/agent/issues/167) - Retry logic should use global timeout
- [#157](https://github.com/link-assistant/agent/issues/157) - Rate limit handling improvements
- [#142](https://github.com/link-assistant/agent/issues/142) - Automatic retry on timeout errors
- [#146](https://github.com/link-assistant/agent/issues/146) - Stream timeout configuration

## Implementation Files

| File | Purpose |
|------|---------|
| `js/src/flag/flag.ts` | Timeout configuration constants |
| `js/src/provider/retry-fetch.ts` | HTTP-level rate limit handling with isolated signals |
| `js/src/session/retry.ts` | Session-level retry logic and state tracking |
| `js/src/session/processor.ts` | Stream processing and error handling |
| `js/src/provider/provider.ts` | Provider timeout configuration |

## Testing

Timeout behavior is tested in:
- `js/tests/retry-fetch.test.ts` - Rate limit handling tests
- `js/tests/session-retry.test.ts` - Session retry logic tests

## Changelog

- **v0.13.3**: Fixed issue #183 - Rate limit waits now use isolated AbortControllers
- **v0.13.0**: Added configurable stream timeouts (AGENT_STREAM_CHUNK_TIMEOUT_MS, AGENT_STREAM_STEP_TIMEOUT_MS)
- **v0.12.0**: Implemented time-based retry logic (AGENT_RETRY_TIMEOUT)
