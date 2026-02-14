import { test, expect, describe } from 'bun:test';
import { MessageV2 } from '../src/session/message-v2.ts';

describe('Stream Parse Error Handling', () => {
  // See: https://github.com/link-assistant/agent/issues/169
  // AI_JSONParseError is NOT retryable — it is skipped at the processor level
  // (case 'error' in fullStream iteration), similar to OpenAI Codex approach.
  // The fromError() function should classify it as UnknownError since
  // the error is handled at the stream level, not at the retry level.

  test('AI_JSONParseError falls through to UnknownError (not retryable)', () => {
    const error = new Error('JSON parsing failed');
    error.name = 'AI_JSONParseError';
    error.text = '{"id":"chatcmpl-jQugNdata:{...';

    const result = MessageV2.fromError(error, { providerID: 'test' });

    // Should be UnknownError — not retryable, not StreamParseError
    // The fix is at the processor level: skip the bad SSE event, not retry
    expect(result.name).toBe('UnknownError');
  });

  test('exact production error from issue #169 classified as UnknownError', () => {
    // This is the exact error from the production log (2026-02-14T08:34:12Z)
    // SSE chunks concatenated: first chunk truncated + "data:" prefix + second chunk
    const error = new Error(
      'AI_JSONParseError: JSON parsing failed: Text: {"id":"chatcmpl-jQugNdata:{"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk","created":1771058051,"model":"kimi-k2.5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"system_fingerprint":"fpv0_f7e5c49a"}.\nError message: JSON Parse error: Expected \'}\''
    );
    error.name = 'AI_JSONParseError';

    const result = MessageV2.fromError(error, { providerID: 'opencode' });

    // Should be UnknownError — the fix handles this at the processor/stream level
    expect(result.name).toBe('UnknownError');
  });

  test('socket errors are still classified correctly', () => {
    const error = new Error('socket connection was closed unexpectedly');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('SocketConnectionError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('timeout errors are still classified correctly', () => {
    const error = new Error('The operation timed out');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('generic errors are classified as UnknownError', () => {
    const error = new Error('Network request failed');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('UnknownError');
  });
});
