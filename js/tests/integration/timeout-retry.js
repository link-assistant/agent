/* eslint-disable no-undef */
import { test, expect, describe } from 'bun:test';
import { MessageV2 } from '../src/session/message-v2.ts';
import { SessionRetry } from '../src/session/retry.ts';

describe('Timeout Error Detection', () => {
  test('detects DOMException TimeoutError', () => {
    const error = new DOMException('The operation timed out.', 'TimeoutError');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
    expect(result.data.message).toBe('The operation timed out.');
  });

  test('detects AbortSignal.timeout() error', () => {
    // Simulate the exact error from AbortSignal.timeout()
    const error = new DOMException('The operation timed out.', 'TimeoutError');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects generic Error with timeout message', () => {
    const error = new Error('The operation timed out');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects Error with "timed out" in message', () => {
    const error = new Error('Request timed out after 300000ms');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('detects Error with TimeoutError name', () => {
    const error = new Error('Connection timed out');
    error.name = 'TimeoutError';

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('TimeoutError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('does not detect regular errors as timeout errors', () => {
    const error = new Error('Some other error');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('UnknownError');
  });

  test('DOMException AbortError is NOT treated as timeout', () => {
    const error = new DOMException('The operation was aborted', 'AbortError');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('MessageAbortedError');
  });

  test('socket error is NOT treated as timeout', () => {
    const error = new Error('The socket connection was closed unexpectedly');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('SocketConnectionError');
  });
});

describe('Timeout Retry Configuration', () => {
  test('has correct timeout max retries', () => {
    expect(SessionRetry.TIMEOUT_MAX_RETRIES).toBe(3);
  });

  test('has correct timeout delays array', () => {
    expect(SessionRetry.TIMEOUT_DELAYS).toEqual([30_000, 60_000, 120_000]);
  });
});

describe('Timeout Delay Calculation', () => {
  test('calculates correct delay for first attempt (30s)', () => {
    const delay = SessionRetry.timeoutDelay(1);
    expect(delay).toBe(30_000);
  });

  test('calculates correct delay for second attempt (60s)', () => {
    const delay = SessionRetry.timeoutDelay(2);
    expect(delay).toBe(60_000);
  });

  test('calculates correct delay for third attempt (120s)', () => {
    const delay = SessionRetry.timeoutDelay(3);
    expect(delay).toBe(120_000);
  });

  test('caps delay at last value for attempts beyond array length', () => {
    const delay = SessionRetry.timeoutDelay(5);
    expect(delay).toBe(120_000);
  });
});

describe('TimeoutError Type', () => {
  test('TimeoutError isRetryable is always true', () => {
    const error = new MessageV2.TimeoutError(
      { message: 'test', isRetryable: true },
      {}
    );
    const obj = error.toObject();

    expect(obj.data.isRetryable).toBe(true);
  });

  test('TimeoutError has correct name', () => {
    const error = new MessageV2.TimeoutError(
      { message: 'test', isRetryable: true },
      {}
    );
    const obj = error.toObject();

    expect(obj.name).toBe('TimeoutError');
  });
});
