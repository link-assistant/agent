# Case Study: Socket Connection Closed Unexpectedly During Streaming API Responses

**Issue ID:** #109
**Created:** 2026-01-10
**Status:** Resolved

## Summary

When using the agent CLI with streaming API providers (e.g., `opencode/grok-code`), the connection frequently fails after approximately 10-12 seconds with the error:

```
Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()
```

## Timeline of Events

1. **2026-01-10T21:19:50Z** - User initiates solve.mjs with `--tool agent` and `--model opencode/grok-code`
2. **2026-01-10T21:20:22Z** - Agent CLI starts in stdin-stream mode
3. **2026-01-10T21:20:23Z** - Agent outputs status message showing it's ready
4. **2026-01-10T21:20:34Z** - After ~12 seconds, socket connection error occurs
5. **2026-01-10T21:20:34Z** - UnhandledRejection error propagates, causing process exit with code 1

## Root Cause Analysis

### Primary Cause: Bun's Default `idleTimeout`

The issue is a **known limitation in Bun's `fetch()` implementation** when used within a `Bun.serve()` context:

1. **Bun's default `idleTimeout` is 10 seconds** in `Bun.serve()` contexts
2. Long-running streaming connections exceed this timeout
3. The upstream provider connection gets dropped unexpectedly

### Evidence

From [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439):
- Bun's `fetch()` has a default idle timeout of 10 seconds
- Any fetch request taking longer than 10 seconds within `Bun.serve()` will fail
- The error message is: "The socket connection was closed unexpectedly"

### Reproduction

```bash
echo '{"message": "Hello, please analyze this code..."}' | agent --model opencode/grok-code
```

Wait approximately 10-12 seconds and observe the socket connection error.

## Technical Details

### Error Signature

```json
{
  "type": "error",
  "timestamp": 1768080034712,
  "sessionID": "ses_45637e0dcffeqxaDRRDyQRd69N",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
    }
  }
}
```

### Error Detection Pattern

The error can be identified by checking:
- Error message contains "socket connection was closed"
- Error message contains "closed unexpectedly"
- The error is typically transient and succeeds on retry

## Solution Implemented

### 1. Socket Error Detection

Added `SocketConnectionError` type in `message-v2.ts` to properly categorize socket connection errors as retryable:

```typescript
export const SocketConnectionError = NamedError.create(
  'SocketConnectionError',
  z.object({
    message: z.string(),
    isRetryable: z.literal(true),
  })
);
```

### 2. Error Pattern Matching

Updated `fromError()` function to detect socket connection errors:

```typescript
// Check for Bun socket connection errors (known Bun issue with 10s idle timeout)
const isSocketError = message.includes('socket connection was closed') ||
                      message.includes('closed unexpectedly');
if (isSocketError) {
  return new MessageV2.SocketConnectionError(
    { message, isRetryable: true },
    { cause: e }
  ).toObject();
}
```

### 3. Retry Logic Enhancement

Updated `processor.ts` to retry socket connection errors with exponential backoff:

```typescript
if (error?.name === 'APIError' && error.data.isRetryable) {
  // existing retry logic
}
// Also retry socket connection errors
if (error?.name === 'SocketConnectionError' && error.data.isRetryable) {
  // same retry logic
}
```

### 4. Retry Configuration

Added socket-specific retry constants in `retry.ts`:

```typescript
export const SOCKET_ERROR_MAX_RETRIES = 3;
export const SOCKET_ERROR_INITIAL_DELAY = 1000; // 1 second
```

## References

- [oven-sh/bun#14439](https://github.com/oven-sh/bun/issues/14439) - ConnectionClosed when fetch > 10s (CLOSED - workaround documented)
- [oven-sh/bun#16719](https://github.com/oven-sh/bun/issues/16719) - Dev server fails after 10+ minutes
- [sst/opencode#2304](https://github.com/sst/opencode/issues/2304) - Error with .git folder
- [sst/opencode#3511](https://github.com/sst/opencode/issues/3511) - Socket error from MCP server
- [link-assistant/hive-mind#1098](https://github.com/link-assistant/hive-mind/issues/1098) - Original report with full case study

## Lessons Learned

1. **Bun's streaming behavior differs from Node.js** - Always test streaming operations with Bun specifically
2. **Socket errors in Bun are often transient** - Retry logic is essential for robust streaming
3. **Verbose mode is critical for debugging** - Enable verbose logging for socket-related errors
4. **10-second timeout is a known Bun limitation** - Long-running requests need special handling

## Files Modified

- `js/src/session/message-v2.ts` - Added SocketConnectionError type and detection
- `js/src/session/processor.ts` - Enhanced retry logic for socket errors
- `js/src/session/retry.ts` - Added socket error retry configuration
