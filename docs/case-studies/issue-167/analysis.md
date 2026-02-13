# Case Study: Issue #167 - Retry Logic Should Use Global Timeout Instead of Retry Count

## Executive Summary

This case study analyzes the failure of `@link-assistant/agent` when hitting rate limits from an AI provider (Moonshot/Kimi K2.5). The core issue is that the retry mechanism failed after only 3 attempts despite a 7-week global retry timeout configuration, because the underlying Vercel AI SDK uses a fixed retry count rather than a time-based retry window.

## Timeline of Events

### 2026-02-13T22:55:40Z - Session Start
- `solve.mjs` started processing issue `netkeep80/aprover#56`
- Working on branch `issue-56-01373fc8d0f5`
- Using model `moonshot/kimi-k2.5-free` via OpenCode API

### 2026-02-13T22:55:54Z - PR Created
- PR #57 created in draft state
- Branch pushed successfully

### 2026-02-13T22:56:08Z - API Call Initiated
- Agent began processing the issue
- Session ID: `ses_3a6c8003bffenifmLHUebstWIb`

### 2026-02-13T22:56:08Z - First Rate Limit Error (HTTP 429)
```
{
  "statusCode": 429,
  "responseHeaders": {
    "retry-after": "3832",  // ~64 minutes
    ...
  },
  "responseBody": "{\"type\":\"error\",\"error\":{\"type\":\"FreeUsageLimitError\",\"message\":\"Rate limit exceeded. Please try again later.\"}}"
}
```

### Key Observations from the Error

1. **retry-after header**: 3832 seconds (~64 minutes) - API explicitly told us to wait
2. **Error type**: `FreeUsageLimitError` - free tier rate limit
3. **isRetryable**: `true` - API indicates this is a retryable error

### 2026-02-13T22:56:08Z - Agent's Retry Logic Triggered

The agent correctly parsed the retry-after header:
```
{
  "service": "session.retry",
  "headerValue": 3832,
  "delayMs": 3832000,
  "message": "parsed retry-after header (seconds)"
}
```

And validated it against the global timeout:
```
{
  "service": "session.retry",
  "retryAfterMs": 3832000,    // ~64 minutes
  "maxRetryTimeout": 604800000, // 7 days
  "message": "using exact retry-after value"
}
```

### 2026-02-13T22:56:08Z - Retry Scheduled
```
{
  "service": "session.processor",
  "errorType": "APIError",
  "attempt": 1,
  "delay": 3949391,  // ~66 minutes with jitter
  "elapsedRetryTime": 0,
  "maxRetryTime": 604800000,  // 7 days
  "message": "retrying"
}
```

### 2026-02-13T22:56:14Z - CRITICAL FAILURE

Despite the agent's retry logic being properly configured, the **Vercel AI SDK** threw an error:

```
AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded. Please try again later.
    at _retryWithExponentialBackoff (/home/hive/.bun/install/global/node_modules/ai/dist/index.mjs:2498:17)
```

## Root Cause Analysis

### The Problem

There are **two competing retry mechanisms**:

1. **Agent's Custom Retry Logic** (`session/retry.ts` + `session/processor.ts`)
   - Time-based: 7-week global timeout (`AGENT_RETRY_TIMEOUT`)
   - Respects retry-after headers
   - Uses exponential backoff up to 20 minutes for unknown wait times
   - **Configuration**: Set `maxRetries: 0` in AI SDK to disable internal retries

2. **Vercel AI SDK's Internal Retry** (`ai/dist/index.mjs`)
   - Count-based: Default 2 retries (3 total attempts)
   - Uses exponential backoff, ignoring retry-after headers
   - **Hardcoded in**: `_retryWithExponentialBackoff` function

### What Went Wrong

The error message "Failed after 3 attempts" indicates the failure came from the AI SDK's internal retry mechanism, NOT the agent's custom retry logic. This happened because:

1. The agent sets `maxRetries: 0` in `streamText()` calls (see `session/prompt.ts:678`)
2. However, the error is occurring at a different layer - possibly during the provider transformation or at the HTTP client level
3. The AI SDK's internal retry logic kicked in before the agent's processor could intercept the error

### Evidence

From `session/prompt.ts`:
```typescript
const result = await processor.process(() =>
  streamText({
    // ...
    maxRetries: 0,  // Disabled at streamText level
    // ...
  })
);
```

From the error stack trace:
```
AI_RetryError: Failed after 3 attempts.
    at _retryWithExponentialBackoff
```

This shows the AI SDK's `_retryWithExponentialBackoff` is still being invoked somewhere in the call chain despite `maxRetries: 0`.

### Contributing Factors

1. **Provider Architecture**: The error might be occurring at the provider/fetch level rather than the streamText level
2. **Vercel AI SDK Bug**: Issue [#7247](https://github.com/vercel/ai/issues/7247) documents that the SDK ignores retry-after headers
3. **Free Tier Limits**: The Kimi K2.5 free tier has strict rate limits (~64 minutes between requests)

## Impact Assessment

### Severity: High

- Failed to complete automated issue resolution
- Wasted setup time (PR creation, branch creation)
- No useful progress made despite having valid retry configuration

### Affected Components

1. `@link-assistant/agent` - retry logic bypassed
2. Vercel AI SDK (`ai@^6.0.1`) - internal retry count too low
3. OpenCode API - passes through rate limit errors

## Proposed Solutions

### Solution 1: Wrap Provider with Custom Retry Layer (Recommended)

Create a middleware that intercepts all API calls and applies the agent's retry logic before the AI SDK processes them.

**Pros:**
- Full control over retry behavior
- Can respect retry-after headers
- Works with any AI SDK version

**Cons:**
- Adds complexity
- Need to maintain wrapper code

### Solution 2: Upgrade Vercel AI SDK

Check if newer versions (6.0.80+) have better retry-after header support as per [PR #7246](https://github.com/vercel/ai/pull/7246).

**Pros:**
- Less custom code
- Benefits from upstream improvements

**Cons:**
- May still not provide time-based global timeout
- Breaking changes possible

### Solution 3: Configure Minimum Retry Interval

Add configuration for minimum retry interval (30 seconds) and ensure the retry-after value is respected:

```typescript
// In flag.ts
export function MIN_RETRY_INTERVAL(): number {
  const val = getEnv('LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL', 'AGENT_MIN_RETRY_INTERVAL');
  return val ? parseInt(val, 10) * 1000 : 30000; // 30 seconds default
}
```

### Solution 4: Report Upstream Issues

1. **Vercel AI SDK**: Request better retry configuration options
2. **OpenCode/Moonshot**: Request longer free tier limits or better rate limit communication

## Recommended Next Steps

1. **Immediate Fix**: Wrap the AI SDK provider with custom fetch that implements the agent's retry logic
2. **Short Term**: Upgrade AI SDK to latest version and re-test
3. **Long Term**: Contribute to AI SDK with better retry customization options

## Related Issues and PRs

- [link-assistant/agent#157](https://github.com/link-assistant/agent/issues/157) - Previous retry timeout work
- [link-assistant/agent#142](https://github.com/link-assistant/agent/issues/142) - Timeout retry configuration
- [vercel/ai#7247](https://github.com/vercel/ai/issues/7247) - Rate limit header support
- [vercel/ai#4842](https://github.com/vercel/ai/issues/4842) - Custom retry callback request
- [vercel/ai#7246](https://github.com/vercel/ai/pull/7246) - Fix for retry-after header support

## Appendix: Configuration Reference

### Current Agent Retry Configuration

| Parameter | Environment Variable | Default | Description |
|-----------|---------------------|---------|-------------|
| Retry Timeout | `AGENT_RETRY_TIMEOUT` | 604800 (7 days) | Total time to retry |
| Max Retry Delay | `AGENT_MAX_RETRY_DELAY` | 1200 (20 min) | Max single retry wait |
| Initial Delay | Hardcoded | 2000 ms | First retry delay |
| Backoff Factor | Hardcoded | 2 | Exponential growth rate |

### AI SDK Default Retry Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| maxRetries | 2 | Number of retry attempts |
| Backoff | Exponential | Increases delay each retry |
| retry-after | Ignored | Does not respect header |
