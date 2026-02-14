import { test, expect, describe } from 'bun:test';
import { MessageV2 } from '../src/session/message-v2.ts';

describe('StreamParseError Detection', () => {
  // See: https://github.com/link-assistant/agent/issues/169
  // AI_JSONParseError should be classified as StreamParseError and be retryable

  test('detects AI_JSONParseError by name', () => {
    const error = new Error('JSON parsing failed');
    error.name = 'AI_JSONParseError';
    error.text = '{"id":"chatcmpl-jQugNdata:{...';

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
    expect(result.data.message).toBe('JSON parsing failed');
    expect(result.data.text).toBe('{"id":"chatcmpl-jQugNdata:{...');
  });

  test('detects exact Kilo Gateway SSE corruption pattern from issue #169', () => {
    // This is the exact error from the production log (2026-02-14T08:34:12Z)
    // SSE chunks concatenated: first chunk truncated + "data:" prefix + second chunk
    const error = new Error(
      'AI_JSONParseError: JSON parsing failed: Text: {"id":"chatcmpl-jQugNdata:{"id":"chatcmpl-iU6vkr3fItZ0Y4rTCmIyAnXO","object":"chat.completion.chunk","created":1771058051,"model":"kimi-k2.5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"system_fingerprint":"fpv0_f7e5c49a"}.\nError message: JSON Parse error: Expected \'}\''
    );
    error.name = 'AI_JSONParseError';

    const result = MessageV2.fromError(error, { providerID: 'opencode' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects AI_JSONParseError in error message', () => {
    const error = new Error('AI_JSONParseError: JSON parsing failed');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects JSON parsing failed error', () => {
    const error = new Error('JSON parsing failed: Unexpected token');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects JSON Parse error', () => {
    const error = new Error("JSON Parse error: Expected '}'");

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects "is not valid JSON" error', () => {
    const error = new Error('"undefined" is not valid JSON');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects Unexpected token in JSON error', () => {
    const error = new Error('Unexpected token < in JSON at position 0');

    const result = MessageV2.fromError(error, { providerID: 'test' });

    expect(result.name).toBe('StreamParseError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('does not classify non-JSON errors as StreamParseError', () => {
    const error = new Error('Network request failed');

    const result = MessageV2.fromError(error, { providerID: 'test' });

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
});

describe('StreamParseError Type', () => {
  test('StreamParseError can be instantiated', () => {
    const error = new MessageV2.StreamParseError(
      {
        message: 'Test parse error',
        isRetryable: true,
        text: 'malformed JSON',
      },
      {}
    );

    expect(error.name).toBe('StreamParseError');
    expect(error.data.message).toBe('Test parse error');
    expect(error.data.isRetryable).toBe(true);
    expect(error.data.text).toBe('malformed JSON');
  });

  test('StreamParseError.isInstance works', () => {
    const error = new MessageV2.StreamParseError(
      { message: 'Test', isRetryable: true },
      {}
    );

    expect(MessageV2.StreamParseError.isInstance(error)).toBe(true);
  });

  test('StreamParseError text field is optional', () => {
    const error = new MessageV2.StreamParseError(
      { message: 'Test', isRetryable: true },
      {}
    );

    expect(error.data.text).toBeUndefined();
  });
});
