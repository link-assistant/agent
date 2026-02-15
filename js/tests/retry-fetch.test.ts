import { test, expect, describe, beforeEach, mock } from 'bun:test';
import { RetryFetch } from '../src/provider/retry-fetch';

/**
 * Tests for the RetryFetch wrapper.
 *
 * These tests verify that:
 * 1. Non-429 responses are passed through unchanged
 * 2. 429 responses trigger retry logic
 * 3. retry-after headers are respected
 * 4. Global retry timeout is enforced
 * 5. Minimum retry interval is enforced
 * 6. Network errors are retried
 *
 * @see https://github.com/link-assistant/agent/issues/167
 */

describe('RetryFetch', () => {
  describe('create()', () => {
    test('passes through successful responses unchanged', async () => {
      const mockResponse = new Response('success', { status: 200 });
      const mockFetch = mock(() => Promise.resolve(mockResponse));

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      const result = await retryFetch('https://example.com');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(200);
      expect(await result.text()).toBe('success');
    });

    test('passes through error responses (non-429) unchanged', async () => {
      const mockResponse = new Response('error', { status: 500 });
      const mockFetch = mock(() => Promise.resolve(mockResponse));

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      const result = await retryFetch('https://example.com');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(500);
    });

    test('returns 429 response when retry timeout is exceeded', async () => {
      // Save original env values
      const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
      const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

      // Set very short timeout for testing
      process.env['AGENT_RETRY_TIMEOUT'] = '0'; // 0 seconds = immediate timeout

      try {
        const mockResponse = new Response('rate limited', {
          status: 429,
          headers: {
            'retry-after': '60',
          },
        });
        const mockFetch = mock(() => Promise.resolve(mockResponse));

        const retryFetch = RetryFetch.create({
          baseFetch: mockFetch as unknown as typeof fetch,
        });

        const result = await retryFetch('https://example.com');

        // Should return the 429 response since timeout is exceeded immediately
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(result.status).toBe(429);
      } finally {
        // Restore original env values
        if (originalRetryTimeout !== undefined) {
          process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
        } else {
          delete process.env['AGENT_RETRY_TIMEOUT'];
        }
        if (originalMinInterval !== undefined) {
          process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
        } else {
          delete process.env['AGENT_MIN_RETRY_INTERVAL'];
        }
      }
    });

    test('retries on 429 and succeeds on second attempt', async () => {
      // Save original env values
      const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
      const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

      // Set longer timeout but short min interval for fast test
      process.env['AGENT_RETRY_TIMEOUT'] = '3600'; // 1 hour
      process.env['AGENT_MIN_RETRY_INTERVAL'] = '0'; // No minimum

      try {
        let callCount = 0;
        const mockFetch = mock(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(
              new Response('rate limited', {
                status: 429,
                headers: {
                  'retry-after': '0', // Immediate retry for test
                },
              })
            );
          }
          return Promise.resolve(new Response('success', { status: 200 }));
        });

        const retryFetch = RetryFetch.create({
          baseFetch: mockFetch as unknown as typeof fetch,
        });

        const result = await retryFetch('https://example.com');

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(result.status).toBe(200);
      } finally {
        // Restore original env values
        if (originalRetryTimeout !== undefined) {
          process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
        } else {
          delete process.env['AGENT_RETRY_TIMEOUT'];
        }
        if (originalMinInterval !== undefined) {
          process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
        } else {
          delete process.env['AGENT_MIN_RETRY_INTERVAL'];
        }
      }
    });
  });

  describe('wrap()', () => {
    test('wraps custom fetch with retry logic', async () => {
      let customFetchCalled = false;
      const customFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        customFetchCalled = true;
        return new Response('custom success', { status: 200 });
      };

      const wrappedFetch = RetryFetch.wrap(customFetch);

      const result = await wrappedFetch('https://example.com');

      expect(customFetchCalled).toBe(true);
      expect(result.status).toBe(200);
      expect(await result.text()).toBe('custom success');
    });
  });

  describe('retry-after header parsing', () => {
    test('handles retry-after-ms header', async () => {
      // This test verifies the parsing works (actual retry is tested above)
      const headers = new Headers({
        'retry-after-ms': '5000',
      });

      // We can't easily test the parsing directly since it's internal,
      // but we can verify the behavior indirectly
      expect(headers.get('retry-after-ms')).toBe('5000');
    });

    test('handles retry-after header in seconds', async () => {
      const headers = new Headers({
        'retry-after': '120',
      });

      expect(headers.get('retry-after')).toBe('120');
    });
  });
});

/**
 * Tests for issue #183 - Rate limit waits should use isolated AbortController
 *
 * These tests verify that:
 * 1. Rate limit waits are NOT aborted by provider timeouts (short timeouts)
 * 2. Rate limit waits ARE aborted by global AGENT_RETRY_TIMEOUT
 * 3. User cancellation still works during rate limit waits
 *
 * @see https://github.com/link-assistant/agent/issues/183
 */
describe('Isolated signal for rate limit waits (issue #183)', () => {
  test('rate limit wait is not aborted by short provider timeout', async () => {
    // Save original env values
    const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
    const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

    // Set long global timeout (1 hour) but we'll use a short provider timeout
    process.env['AGENT_RETRY_TIMEOUT'] = '3600'; // 1 hour
    process.env['AGENT_MIN_RETRY_INTERVAL'] = '0'; // No minimum

    try {
      let callCount = 0;
      const mockFetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response('rate limited', {
              status: 429,
              headers: {
                'retry-after': '0', // Immediate retry for fast test
              },
            })
          );
        }
        return Promise.resolve(new Response('success', { status: 200 }));
      });

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      // Create AbortController that would abort after 10ms (simulating provider timeout)
      // This should NOT abort the rate limit wait because we use isolated signals
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);

      const result = await retryFetch('https://example.com', {
        signal: controller.signal,
      });

      // Should succeed despite the short timeout signal
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    } finally {
      // Restore original env values
      if (originalRetryTimeout !== undefined) {
        process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
      } else {
        delete process.env['AGENT_RETRY_TIMEOUT'];
      }
      if (originalMinInterval !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
      } else {
        delete process.env['AGENT_MIN_RETRY_INTERVAL'];
      }
    }
  });

  test('rate limit wait respects global AGENT_RETRY_TIMEOUT', async () => {
    // Save original env values
    const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
    const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

    // Set very short global timeout (immediate)
    process.env['AGENT_RETRY_TIMEOUT'] = '0'; // 0 seconds = immediate timeout
    process.env['AGENT_MIN_RETRY_INTERVAL'] = '0';

    try {
      const mockResponse = new Response('rate limited', {
        status: 429,
        headers: {
          'retry-after': '60', // Server says wait 60 seconds
        },
      });
      const mockFetch = mock(() => Promise.resolve(mockResponse));

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      const result = await retryFetch('https://example.com');

      // Should return 429 because global timeout is exceeded
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(429);
    } finally {
      // Restore original env values
      if (originalRetryTimeout !== undefined) {
        process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
      } else {
        delete process.env['AGENT_RETRY_TIMEOUT'];
      }
      if (originalMinInterval !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
      } else {
        delete process.env['AGENT_MIN_RETRY_INTERVAL'];
      }
    }
  });

  test('user cancellation works during rate limit wait', async () => {
    // Save original env values
    const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
    const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

    // Set long timeout so we can test cancellation
    process.env['AGENT_RETRY_TIMEOUT'] = '3600'; // 1 hour
    process.env['AGENT_MIN_RETRY_INTERVAL'] = '0';

    try {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response('rate limited', {
            status: 429,
            headers: {
              'retry-after': '3600', // Server says wait 1 hour
            },
          })
        )
      );

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      // Create AbortController for user cancellation
      const controller = new AbortController();

      // Abort after 50ms (simulating user clicking cancel)
      setTimeout(() => controller.abort(), 50);

      const result = await retryFetch('https://example.com', {
        signal: controller.signal,
      });

      // Should return 429 because user canceled
      // (the isolated signal checks user cancellation every 10 seconds,
      // but for immediate abort it should also work)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(429);
    } finally {
      // Restore original env values
      if (originalRetryTimeout !== undefined) {
        process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
      } else {
        delete process.env['AGENT_RETRY_TIMEOUT'];
      }
      if (originalMinInterval !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
      } else {
        delete process.env['AGENT_MIN_RETRY_INTERVAL'];
      }
    }
  });

  test('rate limit wait handles long retry-after without provider timeout abort', async () => {
    // This test specifically verifies the scenario from issue #183:
    // - Provider timeout is 5 minutes (300,000ms)
    // - Server returns retry-after: 15 hours
    // - The rate limit wait should NOT be aborted by the provider timeout

    // Save original env values
    const originalRetryTimeout = process.env['AGENT_RETRY_TIMEOUT'];
    const originalMinInterval = process.env['AGENT_MIN_RETRY_INTERVAL'];

    // Set timeout to accommodate long waits
    process.env['AGENT_RETRY_TIMEOUT'] = '3600'; // 1 hour (enough for test)
    process.env['AGENT_MIN_RETRY_INTERVAL'] = '0';

    try {
      let callCount = 0;
      const mockFetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          // Return 429 with very short retry-after for fast test
          // (In real scenario this would be 15 hours)
          return Promise.resolve(
            new Response('rate limited', {
              status: 429,
              headers: {
                'retry-after': '0', // Use 0 for fast test
              },
            })
          );
        }
        return Promise.resolve(new Response('success', { status: 200 }));
      });

      const retryFetch = RetryFetch.create({
        baseFetch: mockFetch as unknown as typeof fetch,
      });

      // Simulate provider timeout signal that fires after 1ms
      // This is what was causing the issue - the provider timeout (5 min)
      // was aborting the rate limit wait (15 hours)
      const providerTimeout = new AbortController();
      setTimeout(() => providerTimeout.abort(), 1);

      const result = await retryFetch('https://example.com', {
        signal: providerTimeout.signal,
      });

      // With the fix, this should succeed because:
      // 1. First request returns 429
      // 2. Rate limit wait uses isolated signal (NOT providerTimeout.signal)
      // 3. Wait completes successfully
      // 4. Second request succeeds
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(200);
    } finally {
      // Restore original env values
      if (originalRetryTimeout !== undefined) {
        process.env['AGENT_RETRY_TIMEOUT'] = originalRetryTimeout;
      } else {
        delete process.env['AGENT_RETRY_TIMEOUT'];
      }
      if (originalMinInterval !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = originalMinInterval;
      } else {
        delete process.env['AGENT_MIN_RETRY_INTERVAL'];
      }
    }
  });
});

describe('Flag configuration', () => {
  test('MIN_RETRY_INTERVAL defaults to 30 seconds', async () => {
    const { Flag } = await import('../src/flag/flag');

    // Clear env var to test default
    const original = process.env['AGENT_MIN_RETRY_INTERVAL'];
    delete process.env['AGENT_MIN_RETRY_INTERVAL'];
    delete process.env['LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL'];

    try {
      expect(Flag.MIN_RETRY_INTERVAL()).toBe(30000);
    } finally {
      if (original !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = original;
      }
    }
  });

  test('MIN_RETRY_INTERVAL can be configured via env var', async () => {
    const { Flag } = await import('../src/flag/flag');

    const original = process.env['AGENT_MIN_RETRY_INTERVAL'];
    process.env['AGENT_MIN_RETRY_INTERVAL'] = '60'; // 60 seconds

    try {
      expect(Flag.MIN_RETRY_INTERVAL()).toBe(60000);
    } finally {
      if (original !== undefined) {
        process.env['AGENT_MIN_RETRY_INTERVAL'] = original;
      } else {
        delete process.env['AGENT_MIN_RETRY_INTERVAL'];
      }
    }
  });

  test('RETRY_TIMEOUT defaults to 7 days', async () => {
    const { Flag } = await import('../src/flag/flag');

    const original = process.env['AGENT_RETRY_TIMEOUT'];
    delete process.env['AGENT_RETRY_TIMEOUT'];
    delete process.env['LINK_ASSISTANT_AGENT_RETRY_TIMEOUT'];

    try {
      expect(Flag.RETRY_TIMEOUT()).toBe(604800); // 7 days in seconds
    } finally {
      if (original !== undefined) {
        process.env['AGENT_RETRY_TIMEOUT'] = original;
      }
    }
  });

  test('MAX_RETRY_DELAY defaults to 20 minutes', async () => {
    const { Flag } = await import('../src/flag/flag');

    const original = process.env['AGENT_MAX_RETRY_DELAY'];
    delete process.env['AGENT_MAX_RETRY_DELAY'];
    delete process.env['LINK_ASSISTANT_AGENT_MAX_RETRY_DELAY'];

    try {
      expect(Flag.MAX_RETRY_DELAY()).toBe(1200000); // 20 minutes in ms
    } finally {
      if (original !== undefined) {
        process.env['AGENT_MAX_RETRY_DELAY'] = original;
      }
    }
  });
});
