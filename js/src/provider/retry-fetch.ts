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
 * Important: Rate limit waits use ISOLATED AbortControllers that are NOT subject to
 * provider/stream timeouts. This prevents long rate limit waits (e.g., 15 hours) from
 * being aborted by short provider timeouts (e.g., 5 minutes).
 *
 * @see https://github.com/link-assistant/agent/issues/167
 * @see https://github.com/link-assistant/agent/issues/183
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
   * Properly cleans up event listeners to prevent memory leaks.
   */
  async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already aborted before starting
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timeout = setTimeout(resolve, ms);

      if (signal) {
        const abortHandler = () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        };

        signal.addEventListener('abort', abortHandler, { once: true });

        // Clean up the listener when the timeout completes normally
        // This prevents memory leaks on long-running processes
        const originalResolve = resolve;
        // eslint-disable-next-line no-param-reassign
        resolve = (value) => {
          signal.removeEventListener('abort', abortHandler);
          originalResolve(value);
        };
      }
    });
  }

  /**
   * Create an isolated AbortController for rate limit waits.
   *
   * This controller is NOT connected to the request's AbortSignal, so it won't be
   * affected by provider timeouts (default 5 minutes) or stream timeouts.
   * It only respects the global AGENT_RETRY_TIMEOUT.
   *
   * However, it DOES check the user's abort signal periodically (every 10 seconds)
   * to allow user cancellation during long rate limit waits.
   *
   * This solves issue #183 where long rate limit waits (e.g., 15 hours) were being
   * aborted by the provider timeout (5 minutes).
   *
   * @param remainingTimeout Maximum time allowed for this wait (ms)
   * @param userSignal Optional user abort signal to check periodically
   * @returns An object with the signal and a cleanup function
   * @see https://github.com/link-assistant/agent/issues/183
   */
  function createIsolatedRateLimitSignal(
    remainingTimeout: number,
    userSignal?: AbortSignal
  ): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timers: NodeJS.Timeout[] = [];

    // Set a timeout based on the global AGENT_RETRY_TIMEOUT (not provider timeout)
    const globalTimeoutId = setTimeout(() => {
      controller.abort(
        new DOMException(
          'Rate limit wait exceeded global timeout',
          'TimeoutError'
        )
      );
    }, remainingTimeout);
    timers.push(globalTimeoutId);

    // Periodically check if user canceled (every 10 seconds)
    // This allows user cancellation during long rate limit waits
    // without being affected by provider timeouts
    if (userSignal) {
      const checkUserCancellation = () => {
        if (userSignal.aborted) {
          controller.abort(
            new DOMException(
              'User canceled during rate limit wait',
              'AbortError'
            )
          );
        }
      };

      // Check immediately and then every 10 seconds
      checkUserCancellation();
      const intervalId = setInterval(checkUserCancellation, 10_000);
      timers.push(intervalId as unknown as NodeJS.Timeout);
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        for (const timer of timers) {
          clearTimeout(timer);
          clearInterval(timer as unknown as NodeJS.Timeout);
        }
      },
    };
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

        const remainingTimeout = maxRetryTimeout - elapsed;

        log.info(() => ({
          message: 'rate limited, will retry',
          sessionID,
          attempt,
          delay,
          delayMinutes: (delay / 1000 / 60).toFixed(2),
          delayHours: (delay / 1000 / 3600).toFixed(2),
          elapsed,
          remainingTimeout,
          remainingTimeoutHours: (remainingTimeout / 1000 / 3600).toFixed(2),
          isolatedSignal: true, // Indicates we're using isolated signal for this wait
        }));

        // Wait before retrying using ISOLATED signal
        // This is critical for issue #183: Rate limit waits can be hours long (e.g., 15 hours),
        // but provider timeouts are typically 5 minutes. By using an isolated AbortController
        // that only respects AGENT_RETRY_TIMEOUT, we prevent the provider timeout from
        // aborting long rate limit waits.
        //
        // The isolated signal periodically checks the user's abort signal (every 10 seconds)
        // to allow user cancellation during long waits.
        const { signal: isolatedSignal, cleanup } =
          createIsolatedRateLimitSignal(
            remainingTimeout,
            init?.signal ?? undefined
          );

        try {
          await sleep(delay, isolatedSignal);
        } catch (sleepError) {
          // Check if the original request was aborted (user cancellation)
          // In that case, we should stop retrying
          if (init?.signal?.aborted) {
            log.info(() => ({
              message: 'rate limit wait aborted by user cancellation',
              sessionID,
            }));
            return response;
          }

          // Otherwise, it was the isolated timeout - log and return
          log.info(() => ({
            message: 'rate limit wait exceeded global timeout',
            sessionID,
            sleepError: String(sleepError),
          }));
          return response;
        } finally {
          cleanup();
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
