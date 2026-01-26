import { test, expect, describe } from 'bun:test';
import { MessageV2 } from '../src/session/message-v2.ts';
import { SessionRetry } from '../src/session/retry.ts';

describe('Socket Connection Error Detection', () => {
  test('detects Bun socket connection error from message', () => {
    const error = new Error(
      'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()'
    );

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('SocketConnectionError');
    expect(result.data.isRetryable).toBe(true);
    expect(result.data.message).toContain('socket connection was closed');
  });

  test('detects socket error with "closed unexpectedly" message', () => {
    const error = new Error('Connection closed unexpectedly');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('SocketConnectionError');
    expect(result.data.isRetryable).toBe(true);
  });

  test('does not detect regular errors as socket errors', () => {
    const error = new Error('Some other error');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('UnknownError');
  });

  test('handles DOMException AbortError correctly', () => {
    // DOMException is a global in Bun runtime
    // eslint-disable-next-line no-undef
    const error = new DOMException('The operation was aborted', 'AbortError');

    const result = MessageV2.fromError(error, { providerID: 'test-provider' });

    expect(result.name).toBe('MessageAbortedError');
  });
});

describe('Socket Retry Configuration', () => {
  test('has correct socket error max retries', () => {
    expect(SessionRetry.SOCKET_ERROR_MAX_RETRIES).toBe(3);
  });

  test('has correct socket error initial delay', () => {
    expect(SessionRetry.SOCKET_ERROR_INITIAL_DELAY).toBe(1000);
  });

  test('has correct socket error backoff factor', () => {
    expect(SessionRetry.SOCKET_ERROR_BACKOFF_FACTOR).toBe(2);
  });
});

describe('Socket Error Delay Calculation', () => {
  test('calculates correct delay for first attempt', () => {
    const delay = SessionRetry.socketErrorDelay(1);
    expect(delay).toBe(1000); // 1 second
  });

  test('calculates correct delay for second attempt', () => {
    const delay = SessionRetry.socketErrorDelay(2);
    expect(delay).toBe(2000); // 2 seconds
  });

  test('calculates correct delay for third attempt', () => {
    const delay = SessionRetry.socketErrorDelay(3);
    expect(delay).toBe(4000); // 4 seconds
  });

  test('uses exponential backoff pattern', () => {
    const delay1 = SessionRetry.socketErrorDelay(1);
    const delay2 = SessionRetry.socketErrorDelay(2);
    const delay3 = SessionRetry.socketErrorDelay(3);

    expect(delay2).toBe(delay1 * 2);
    expect(delay3).toBe(delay2 * 2);
  });
});

describe('SocketConnectionError Type', () => {
  test('SocketConnectionError isRetryable is always true', () => {
    const error = new MessageV2.SocketConnectionError(
      { message: 'test', isRetryable: true },
      {}
    );
    const obj = error.toObject();

    expect(obj.data.isRetryable).toBe(true);
  });

  test('SocketConnectionError has correct name', () => {
    const error = new MessageV2.SocketConnectionError(
      { message: 'test', isRetryable: true },
      {}
    );
    const obj = error.toObject();

    expect(obj.name).toBe('SocketConnectionError');
  });
});
