import { Log } from '../util/log';
import { Flag } from '../flag/flag';

/**
 * Custom fetch wrapper that handles rate limits (HTTP 429) using time-based retry logic.
 *
 * This wrapper intercepts 429 responses at the HTTP level before the AI SDK's internal
 * retry mechanism can interfere. It respects:
 * - retry-after headers (both seconds and HTTP date formats)
 * - retry-after-ms header for millisecond precision
 * - AGENT_RETRY_TIMEOUT for global time-based retry limit
 * - AGENT_MAX_RETRY_DELAY for maximum single retry wait time
 *
 * Problem solved:
 * The AI SDK's internal retry uses a fixed count (default 3 attempts) and ignores
 * retry-after headers. When providers return long retry-after values (e.g., 64 minutes),
 * the SDK exhausts its retries before the agent can properly wait.
 *
 * Solution:
 * By wrapping fetch, we handle rate limits at the HTTP layer with time-based retries,
 * ensuring the agent's 7-week global timeout is respected.
 *
 * @see https://github.com/link-assistant/agent/issues/167
 * @see https://github.com/vercel/ai/issues/12585
 */

export namespace RetryFetch {
  const log = Log.create({ service: 'retry-fetch' });

  // Retry configuration constants matching SessionRetry
  const RETRY_INITIAL_DELAY = 2000;
  const RETRY_BACKOFF_FACTOR = 2;
  const RETRY_MAX_DELAY_NO_HEADERS = 30_000;

  // Minimum retry interval to prevent rapid retries (default: 30 seconds)
  // Can be configured via AGENT_MIN_RETRY_INTERVAL env var
  function getMinRetryInterval(): number {
    return Flag.MIN_RETRY_INTERVAL();
  }

  /**
   * Add jitter to a delay value to prevent thundering herd.
   * Adds 0-10% random variation to the delay.
   */
  function addJitter(delay: number): number {
    const jitter = Math.random() * 0.1 * delay;
    return Math.round(delay + jitter);
  }

  /**
   * Parse retry-after value from response headers and return delay in milliseconds.
   * Returns null if no valid retry-after header is found.
   */
  function parseRetryAfterHeader(headers: Headers): number | null {
    // Check for retry-after-ms header first (milliseconds)
    const retryAfterMs = headers.get('retry-after-ms');
    if (retryAfterMs) {
      const parsedMs = Number.parseFloat(retryAfterMs);
      if (!Number.isNaN(parsedMs) && parsedMs > 0) {
        log.info(() => ({
          message: 'parsed retry-after-ms header',
          headerValue: parsedMs,
        }));
        return parsedMs;
      }
    }

    // Check for retry-after header (seconds or HTTP date)
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const parsedSeconds = Number.parseFloat(retryAfter);
      if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
        const delayMs = Math.ceil(parsedSeconds * 1000);
        log.info(() => ({
          message: 'parsed retry-after header (seconds)',
          headerValue: parsedSeconds,
          delayMs,
        }));
        return delayMs;
      }
      // Try parsing as HTTP date format
      const parsed = Date.parse(retryAfter) - Date.now();
      if (!Number.isNaN(parsed) && parsed > 0) {
        log.info(() => ({
          message: 'parsed retry-after header (date)',
          headerValue: retryAfter,
          delayMs: parsed,
        }));
        return Math.ceil(parsed);
      }
    }

    return null;
  }

  /**
   * Calculate retry delay based on headers and attempt number.
   * Returns null if retry-after exceeds the global retry timeout.
   */
  function calculateRetryDelay(
    headers: Headers,
    attempt: number,
    maxRetryTimeout: number,
    maxBackoffDelay: number
  ): number | null {
    const retryAfterMs = parseRetryAfterHeader(headers);
    const minInterval = getMinRetryInterval();

    if (retryAfterMs !== null) {
      // Check if retry-after exceeds the maximum retry timeout
      if (retryAfterMs > maxRetryTimeout) {
        log.error(() => ({
          message:
            'retry-after exceeds maximum retry timeout, will not retry at fetch level',
          retryAfterMs,
          maxRetryTimeout,
          retryAfterHours: (retryAfterMs / 1000 / 3600).toFixed(2),
          maxRetryTimeoutHours: (maxRetryTimeout / 1000 / 3600).toFixed(2),
        }));
        return null;
      }

      // Use exact retry-after time, but ensure minimum interval
      const delay = Math.max(retryAfterMs, minInterval);
      log.info(() => ({
        message: 'using retry-after value',
        retryAfterMs,
        delay,
        minInterval,
      }));
      return addJitter(delay);
    }

    // No retry-after header - use exponential backoff
    const backoffDelay = Math.min(
      RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
      maxBackoffDelay
    );
    const delay = Math.max(backoffDelay, minInterval);
    log.info(() => ({
      message: 'no retry-after header, using exponential backoff',
      attempt,
      backoffDelay,
      delay,
      minInterval,
      maxBackoffDelay,
    }));
    return addJitter(delay);
  }

  /**
   * Sleep for the specified duration, but respect abort signals.
   */
  async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      }
    });
  }

  /**
   * Check if an error is retryable (network issues, temporary failures).
   */
  function isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    // Socket/connection errors (Bun has known timeout issues)
    // See: https://github.com/oven-sh/bun/issues/14439
    if (
      error.message.includes('ConnectionClosed') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('socket') ||
      error.message.includes('connection')
    ) {
      return true;
    }

    return false;
  }

  export type RetryFetchOptions = {
    /**
     * Original fetch function to wrap. Defaults to global fetch.
     */
    baseFetch?: typeof fetch;

    /**
     * Session ID for logging purposes.
     */
    sessionID?: string;
  };

  /**
   * Create a fetch function that handles rate limits with time-based retry logic.
   *
   * This wrapper:
   * 1. Intercepts HTTP 429 responses
   * 2. Parses retry-after headers
   * 3. Waits for the specified duration (respecting global timeout)
   * 4. Retries the request
   *
   * If retry-after exceeds AGENT_RETRY_TIMEOUT, the original 429 response is returned
   * to let higher-level error handling take over.
   *
   * @param options Configuration options
   * @returns A fetch function with rate limit retry handling
   */
  export function create(options: RetryFetchOptions = {}): typeof fetch {
    const baseFetch = options.baseFetch ?? fetch;
    const sessionID = options.sessionID ?? 'unknown';

    return async function retryFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      let attempt = 0;
      const startTime = Date.now();
      const maxRetryTimeout = Flag.RETRY_TIMEOUT() * 1000;
      const maxBackoffDelay = Flag.MAX_RETRY_DELAY();

      while (true) {
        attempt++;
        let response: Response;

        try {
          response = await baseFetch(input, init);
        } catch (error) {
          // Check if it's a retryable network error
          if (isRetryableError(error)) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= maxRetryTimeout) {
              log.warn(() => ({
                message:
                  'network error retry timeout exceeded, re-throwing error',
                sessionID,
                elapsed,
                maxRetryTimeout,
                error: (error as Error).message,
              }));
              throw error;
            }

            // Use exponential backoff for network errors
            const delay = Math.min(
              2000 * Math.pow(2, attempt - 1),
              maxBackoffDelay
            );
            log.info(() => ({
              message: 'network error, retrying',
              sessionID,
              attempt,
              delay,
              error: (error as Error).message,
            }));
            await sleep(delay, init?.signal ?? undefined);
            continue;
          }
          throw error;
        }

        // Only handle rate limit errors (429)
        if (response.status !== 429) {
          return response;
        }

        // Check if we're within the global retry timeout
        const elapsed = Date.now() - startTime;
        if (elapsed >= maxRetryTimeout) {
          log.warn(() => ({
            message: 'retry timeout exceeded in fetch wrapper, returning 429',
            sessionID,
            elapsed,
            maxRetryTimeout,
          }));
          return response; // Let higher-level handling take over
        }

        // Calculate retry delay
        const delay = calculateRetryDelay(
          response.headers,
          attempt,
          maxRetryTimeout - elapsed, // Remaining time
          maxBackoffDelay
        );

        // If delay is null, retry-after exceeds timeout - return response
        if (delay === null) {
          log.warn(() => ({
            message:
              'retry-after exceeds remaining timeout, returning 429 response',
            sessionID,
            elapsed,
            remainingTimeout: maxRetryTimeout - elapsed,
          }));
          return response;
        }

        // Check if delay would exceed remaining timeout
        if (elapsed + delay >= maxRetryTimeout) {
          log.warn(() => ({
            message: 'delay would exceed retry timeout, returning 429 response',
            sessionID,
            elapsed,
            delay,
            maxRetryTimeout,
          }));
          return response;
        }

        log.info(() => ({
          message: 'rate limited, will retry',
          sessionID,
          attempt,
          delay,
          delayMinutes: (delay / 1000 / 60).toFixed(2),
          elapsed,
          remainingTimeout: maxRetryTimeout - elapsed,
        }));

        // Wait before retrying
        try {
          await sleep(delay, init?.signal ?? undefined);
        } catch {
          // Aborted - return the last response
          log.info(() => ({
            message: 'retry sleep aborted, returning last response',
            sessionID,
          }));
          return response;
        }
      }
    };
  }

  /**
   * Wrap an existing custom fetch (e.g., OAuth fetch) with retry logic.
   *
   * This allows composing multiple fetch wrappers while maintaining retry handling.
   *
   * @param customFetch The custom fetch function to wrap
   * @param options Configuration options
   * @returns A fetch function with both custom logic and retry handling
   */
  export function wrap(
    customFetch: typeof fetch,
    options: Omit<RetryFetchOptions, 'baseFetch'> = {}
  ): typeof fetch {
    return create({
      ...options,
      baseFetch: customFetch,
    });
  }
}
