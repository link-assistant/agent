import { test, expect, describe, beforeEach } from 'bun:test';
import { SessionRetry } from '../src/session/retry.ts';
import { Flag } from '../src/flag/flag.ts';

describe('SessionRetry State Management', () => {
  beforeEach(() => {
    // Clear any existing retry state
    SessionRetry.clearRetryState('test-session');
  });

  test('shouldRetry returns true for first error', () => {
    const result = SessionRetry.shouldRetry('test-session', '429');

    expect(result.shouldRetry).toBe(true);
    expect(result.elapsedTime).toBe(0);
  });

  test('shouldRetry resets on different error type', () => {
    // First error type
    SessionRetry.shouldRetry('test-session', '429');
    SessionRetry.updateRetryState('test-session', 1000);

    // Different error type - should reset
    const result = SessionRetry.shouldRetry('test-session', '503');

    expect(result.shouldRetry).toBe(true);
    expect(result.elapsedTime).toBe(0);
  });

  test('clearRetryState removes session state', () => {
    SessionRetry.shouldRetry('test-session', '429');
    SessionRetry.updateRetryState('test-session', 1000);

    SessionRetry.clearRetryState('test-session');

    // After clearing, should start fresh
    const result = SessionRetry.shouldRetry('test-session', '429');
    expect(result.elapsedTime).toBe(0);
  });
});

describe('SessionRetry Delay Calculation', () => {
  // Helper to create error object in the format expected by SessionRetry.delay()
  // The delay function expects { name: string, data: APIErrorData }
  function createAPIError(message, statusCode, responseHeaders = {}) {
    return {
      name: 'APIError',
      data: {
        message,
        isRetryable: true,
        statusCode,
        responseHeaders,
      },
    };
  }

  test('calculates delay from retry-after-ms header', () => {
    const error = createAPIError('Rate limit exceeded', 429, {
      'retry-after-ms': '5000',
    });

    const delay = SessionRetry.delay(error, 1);

    // Should respect retry-after-ms header with jitter
    expect(delay).toBeGreaterThanOrEqual(5000);
    expect(delay).toBeLessThanOrEqual(5500); // 10% jitter max
  });

  test('calculates delay from retry-after header (seconds)', () => {
    const error = createAPIError('Rate limit exceeded', 429, {
      'retry-after': '10',
    });

    const delay = SessionRetry.delay(error, 1);

    // Should convert seconds to ms with jitter
    expect(delay).toBeGreaterThanOrEqual(10000);
    expect(delay).toBeLessThanOrEqual(11000); // 10% jitter max
  });

  test('caps delay at max retry delay', () => {
    const maxDelay = Flag.MAX_RETRY_DELAY(); // Default: 20 minutes (1200000ms)

    const error = createAPIError('Rate limit exceeded', 429, {
      // Very long retry-after (3.75 hours = 13473 seconds)
      'retry-after': '13473',
    });

    const delay = SessionRetry.delay(error, 1);

    // Should be capped at max delay (with jitter)
    expect(delay).toBeGreaterThanOrEqual(maxDelay);
    expect(delay).toBeLessThanOrEqual(maxDelay * 1.1); // 10% jitter max
  });

  test('uses exponential backoff without retry-after header', () => {
    const error = createAPIError('Rate limit exceeded', 429, {});

    const delay1 = SessionRetry.delay(error, 1);
    const delay2 = SessionRetry.delay(error, 2);
    const delay3 = SessionRetry.delay(error, 3);

    // Should follow exponential backoff pattern (approximately)
    // 2000, 4000, 8000 with jitter
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay1).toBeLessThanOrEqual(2200);
    expect(delay2).toBeGreaterThanOrEqual(4000);
    expect(delay2).toBeLessThanOrEqual(4400);
    expect(delay3).toBeGreaterThanOrEqual(8000);
    expect(delay3).toBeLessThanOrEqual(8800);
  });

  test('caps exponential backoff without headers', () => {
    // Error without responseHeaders
    const error = {
      name: 'APIError',
      data: {
        message: 'Server error',
        isRetryable: true,
        statusCode: 500,
      },
    };

    // Very high attempt number
    const delay = SessionRetry.delay(error, 20);

    // Should be capped at RETRY_MAX_DELAY_NO_HEADERS (30s) with jitter
    expect(delay).toBeLessThanOrEqual(33000); // 30s + 10% jitter
  });
});

describe('SessionRetry Configuration', () => {
  test('getMaxRetryDelay returns default value', () => {
    const maxDelay = SessionRetry.getMaxRetryDelay();
    // Default: 20 minutes in ms
    expect(maxDelay).toBe(1200000);
  });

  test('RETRY_TIMEOUT has expected default', () => {
    const timeout = Flag.RETRY_TIMEOUT();
    // Default: 7 days in seconds
    expect(timeout).toBe(604800);
  });
});
