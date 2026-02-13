# Case Study: Issue #157 - Title Generation Rate Limit and Retry Timeout

## Issue Summary

The `@link-assistant/agent` CLI failed with "failed to generate title" error when using a free-tier model (kimi-k2.5-free) due to rate limiting. The underlying issue is that the title generation feature uses tokens for a non-essential operation, and when rate-limited, the retry logic doesn't wait long enough before retrying.

**Issue URL:** https://github.com/link-assistant/agent/issues/157

## Timeline of Events

1. **2026-02-13T20:15:04Z** - User starts solve.mjs with `--tool agent --model kimi-k2.5-free`
2. **2026-02-13T20:15:26Z** - Agent CLI starts, creates session, begins processing
3. **2026-02-13T20:15:27Z** - First API call for title generation hits 429 rate limit
   - Response: `{"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}}`
   - Headers: `retry-after: 13473` (about 3.75 hours)
4. **2026-02-13T20:15:29Z** - Second retry, still rate limited (retry-after: 13471)
5. **2026-02-13T20:15:33Z** - Third retry, still rate limited (retry-after: 13467)
6. **2026-02-13T20:15:33Z** - Error thrown: `AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded.`
7. **2026-02-13T20:15:33Z** - Application crashes with "failed to generate title" error

## Root Cause Analysis

### Primary Issue: Title Generation is Non-Critical but Blocking

The `ensureTitle()` function in `js/src/session/prompt.ts` (lines 1534-1652) attempts to generate a title for each new session. While this happens asynchronously (not awaited), when it fails, it:
1. Uses tokens from the rate-limited quota
2. Logs an error that can be confusing to users
3. Wastes API calls on a feature that isn't essential for the core operation

### Secondary Issue: Insufficient Retry Logic

The current retry logic has two problems:

1. **Default retries too few**: The `generateText` call has `maxRetries: 0` or doesn't specify it, relying on internal defaults (typically 2-3 retries)

2. **Ignores retry-after header**: The Vercel AI SDK's built-in retry uses exponential backoff but **ignores the `retry-after` header** from providers. This is a [known issue](https://github.com/vercel/ai/issues/7247). In this case, the API returned `retry-after: 13473` (about 3.75 hours), but the SDK retried within seconds.

### Code Evidence

From the logs, the title generation request:
```json
{
  "model": "kimi-k2.5-free",
  "max_tokens": 1500,
  "messages": [
    {"role": "system", "content": "You are a title generator..."},
    {"role": "user", "content": "The following is the text to summarize:"},
    {"role": "user", "content": "[long system prompt text]"}
  ]
}
```

Response from all three attempts:
```json
{
  "statusCode": 429,
  "responseHeaders": {
    "retry-after": "13467",
    "content-type": "text/plain;charset=UTF-8"
  },
  "responseBody": "{\"type\":\"error\",\"error\":{\"type\":\"FreeUsageLimitError\",\"message\":\"Rate limit exceeded. Please try again later.\"}}",
  "isRetryable": true
}
```

## Proposed Solutions

### Solution 1: Make Title Generation Optional (--generate-title flag)

Add a `--generate-title` command-line option that defaults to `false`. This allows users to:
- Save tokens by disabling title generation entirely
- Enable it when desired for better session organization

**Implementation:**
1. Add `--generate-title` CLI option to `js/src/index.js`
2. Add `AGENT_GENERATE_TITLE` flag to `js/src/flag/flag.ts`
3. Modify `ensureTitle()` in `js/src/session/prompt.ts` to check the flag

### Solution 2: Enhanced Retry with Exponential Backoff and Configurable Timeout

Implement a robust retry mechanism that:
1. Respects `retry-after` headers from the API
2. Uses exponential backoff with jitter
3. Has configurable maximum timeout via `--retry-timeout` option
4. Defaults to 7 days total timeout for same error type

**Implementation:**
1. Add `--retry-timeout` CLI option (default: 7 days in seconds = 604800)
2. Create or extend retry utility in `js/src/session/retry.ts`
3. Implement header-aware retry logic:
   ```typescript
   function calculateRetryDelay(response: Response, attempt: number): number {
     const retryAfter = response.headers.get('retry-after');
     if (retryAfter) {
       const seconds = parseInt(retryAfter, 10);
       if (!isNaN(seconds)) return seconds * 1000;
     }
     // Fallback to exponential backoff with jitter
     const baseDelay = Math.min(RETRY_INITIAL_DELAY * Math.pow(2, attempt), MAX_DELAY);
     const jitter = Math.random() * 0.1 * baseDelay;
     return baseDelay + jitter;
   }
   ```

### Solution 3: Report Issue to Vercel AI SDK (Upstream)

The root issue is that the Vercel AI SDK ignores `retry-after` headers. This has been reported:
- [Issue #7247: SDK does not respect rate limit headers from API providers](https://github.com/vercel/ai/issues/7247)

We should:
1. Monitor this issue for fixes
2. Consider implementing a wrapper middleware if the issue persists

## Best Practices for Retry Logic

Based on research from [AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html), [OpenAI](https://platform.openai.com/docs/guides/rate-limits), and [Better Stack](https://betterstack.com/community/guides/monitoring/exponential-backoff/):

1. **Add Jitter**: Prevent thundering herd by adding randomness to retry times
2. **Cap Maximum Delay**: Typically 20 minutes maximum per retry
3. **Limit Total Retry Duration**: 7 days default for persistent errors
4. **Differentiate Error Types**: Reset timer for different errors
5. **Respect retry-after Headers**: When provided, use them instead of calculated backoff
6. **Log and Monitor**: Track retry attempts for debugging

## Configuration Recommendations

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_GENERATE_TITLE` | `false` | Enable/disable title generation |
| `AGENT_RETRY_TIMEOUT` | `604800` | Maximum retry duration in seconds (7 days) |
| `AGENT_MAX_RETRY_DELAY` | `1200` | Maximum single retry delay in seconds (20 min) |

### CLI Options

```bash
agent --model opencode/kimi-k2.5-free \
      --generate-title=false \
      --retry-timeout=86400  # 1 day
```

## Impact Assessment

| Aspect | Before | After |
|--------|--------|-------|
| Token Usage | Always generates title | Optional, disabled by default |
| Rate Limit Handling | 3 retries with ~1s delays | Respects retry-after, up to 7 days |
| User Experience | Confusing error message | Clear behavior, configurable |
| Free Tier Compatibility | Problematic | Works well |

## Files Modified

1. `js/src/index.js` - Add CLI options
2. `js/src/flag/flag.ts` - Add feature flags
3. `js/src/session/prompt.ts` - Conditional title generation
4. `js/src/session/retry.ts` - Enhanced retry logic
5. `js/CHANGELOG.md` - Document changes

## References

- [Vercel AI SDK Retry Issue #7247](https://github.com/vercel/ai/issues/7247)
- [AWS Retry with Backoff Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/retry-backoff.html)
- [AWS Timeouts, Retries and Backoff with Jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [OpenAI Rate Limits Guide](https://platform.openai.com/docs/guides/rate-limits)
- [Better Stack: Mastering Exponential Backoff](https://betterstack.com/community/guides/monitoring/exponential-backoff/)
