# Case Study: Premature Retry Failure (Issue #169)

## Summary

The issue reports that the retry mechanism failed sooner than the expected 7-day retry window. Analysis reveals this was caused by an unhandled `AI_JSONParseError` from the Vercel AI SDK when processing malformed SSE streaming data from the Kimi K2.5 API via OpenRouter.

## Timeline of Events

| Time | Event | Details |
|------|-------|---------|
| 08:28:31 | Process started | Using `kimi-k2.5-free` model via OpenRouter |
| 08:28:52 | Branch pushed | `issue-761-a0caf45f6eba` |
| 08:28:58 | PR created | PR #778 created |
| 08:29:06 | First session started | `ses_3a4bb6d8dffeiS5FRAjqmkJinT` |
| 08:29:08 | Rate limit hit (429) | `retry-after: 55852` seconds (~15.5 hours) |
| 08:29:08 | Retry scheduled | Will retry with 59155378ms delay (~16.4 hours) |
| 08:29:11 - 08:30:31 | Multiple 429s | All correctly scheduled for retry |
| 08:33:41 | Second agent session | `ses_3a4b73b0effeFXKMNNCv1Lm3b2` |
| 08:34:12 | **Fatal error** | `AI_JSONParseError` - JSON parsing failed |
| 08:34:12 | Process terminated | Error classified as `UsageLimit` |

**Total runtime: ~5 minutes** (not 7 days)

## Root Cause Analysis

### Primary Root Cause: Malformed SSE Response

The API returned corrupted JSON in the SSE stream:

```json
{"id":"chatcmpl-jQugNdata:{"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk"...
```

Note the malformed data: `"chatcmpl-jQugNdata:{"` - this appears to be two SSE chunks concatenated together incorrectly. The correct format would be separate SSE events.

### Secondary Root Cause: AI_JSONParseError Not Retried

The `AI_JSONParseError` is not classified as a retryable error in the current implementation:

1. **In `retry-fetch.ts`**: Only handles HTTP 429 responses and network errors (ConnectionClosed, ECONNRESET, etc.)
2. **In `message-v2.ts`**: Only classifies these errors as retryable:
   - `APICallError` with `isRetryable: true`
   - `TimeoutError`
   - `SocketConnectionError`
3. **AI_JSONParseError** falls through to `NamedError.Unknown` which is **not retryable**

### Tertiary Root Cause: Error Misclassification

The solve script detected the error pattern "Tool execution aborted" and misclassified it as `UsageLimit`, exiting the retry loop:

```json
{
  "errorType": "UsageLimit",
  "errorMatch": "Tool execution aborted",
  "limitReached": true
}
```

## Technical Deep Dive

### SSE Parsing Issue

According to [OpenRouter SSE Streaming Documentation](https://openrouter.ai/docs/api/reference/streaming):

> "Some SSE client implementations might not parse the payload according to spec... leads to an uncaught error when you JSON.stringify the non-JSON payloads."

The Vercel AI SDK handles SSE parsing internally. When the Kimi API returns malformed JSON (possibly due to response concatenation at the OpenRouter proxy level), the SDK throws `AI_JSONParseError`.

### Error Flow

```
Kimi API → OpenRouter → Malformed SSE → AI SDK → AI_JSONParseError
                                                         ↓
                                        MessageV2.fromError() → NamedError.Unknown
                                                         ↓
                                        processor.ts checks: isRetryableAPIError? NO
                                                         ↓
                                        Error published, session terminated
```

### Vercel AI SDK Behavior

Per [GitHub Issue #4099](https://github.com/vercel/ai/issues/4099):

> "The error will happen after the function in your example has returned the stream text result... The error happens during the consumption of the stream, not during the creation."

This means:
1. Stream parsing errors occur asynchronously during consumption
2. They cannot be caught by wrapping `streamText()` in try/catch
3. Errors flow through the stream's `fullStream` or `onError` callback

## Contributing Factors

1. **Kimi K2.5 Free Tier**: Higher error rates due to rate limiting and provider routing
2. **OpenRouter Proxy**: Can introduce SSE parsing issues when proxying streams
3. **No Response Healing**: OpenRouter's [Response Healing](https://openrouter.ai/docs/guides/features/plugins/response-healing) feature could help but may not be enabled
4. **AI SDK Default Retries**: Default `maxRetries: 2` may not apply to stream consumption errors

## Comparison with Expected Behavior

| Aspect | Expected | Actual |
|--------|----------|--------|
| Retry duration | 7 days | ~5 minutes |
| Error handling | Retry all transient errors | Only HTTP 429 and network errors |
| JSONParseError | Should retry (transient) | Not retried (treated as fatal) |
| Error classification | Accurate | Misclassified as UsageLimit |

## Related Issues and PRs

- [OpenCode #11541](https://github.com/anomalyco/opencode/issues/11541): Kimi K2.5 with OpenRouter errors
- [OpenCode #11596](https://github.com/anomalyco/opencode/pull/11596): Fix for Kimi K2.5 reasoning field errors
- [Vercel AI #4099](https://github.com/vercel/ai/issues/4099): streamText error handling
- [Vercel AI #12585](https://github.com/vercel/ai/issues/12585): AI SDK ignores retry-after headers (related)

## Recommendations

### Short-term Fixes

1. **Add AI_JSONParseError to retryable errors**:
   ```typescript
   // In message-v2.ts fromError()
   case e?.name === 'AI_JSONParseError':
     return new MessageV2.APIError({
       message: e.message,
       statusCode: 500, // Treat as server error
       isRetryable: true, // Mark as retryable
       responseHeaders: {},
       responseBody: e.text,
     }, { cause: e }).toObject();
   ```

2. **Use AI SDK's onError callback** for better stream error handling

3. **Implement stream-level retry** that wraps the entire stream consumption

### Long-term Fixes

1. **Create JSONParseError error class** with `isRetryable: true`
2. **Improve error classification** in solve script to distinguish transient from permanent errors
3. **Add response validation** before parsing
4. **Consider enabling OpenRouter's Response Healing** for free tier models

### Configuration

Add environment variable to control JSONParseError retry behavior:
```bash
AGENT_RETRY_JSON_PARSE_ERRORS=true
```

## Files to Modify

1. `js/src/session/message-v2.ts` - Add JSONParseError handling in `fromError()`
2. `js/src/session/processor.ts` - Add JSONParseError to retryable error checks
3. `js/src/provider/retry-fetch.ts` - Consider adding stream-level retry wrapper

## External Reports Needed

1. **OpenRouter**: Report malformed SSE response issue with Kimi K2.5
2. **Vercel AI SDK**: Clarify retry behavior for JSONParseError (or propose making it retryable)

## Conclusion

The "premature failure" was caused by an unhandled stream parsing error (`AI_JSONParseError`) that the retry logic doesn't recognize as retryable. The 7-day retry window works correctly for HTTP 429 rate limits but doesn't cover all transient error types. The fix requires extending the retryable error classification to include stream parsing errors that are typically transient and recoverable upon retry.
