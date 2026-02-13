import { MessageV2 } from './message-v2';
import { Flag } from '../flag/flag';
import { Log } from '../util/log';

export namespace SessionRetry {
  const log = Log.create({ service: 'session.retry' });

  export const RETRY_INITIAL_DELAY = 2000;
  export const RETRY_BACKOFF_FACTOR = 2;
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000; // 30 seconds

  // Maximum delay for a single retry attempt when NO retry-after header (default: 20 minutes)
  // This caps exponential backoff when headers are not available
  // Can be configured via AGENT_MAX_RETRY_DELAY env var
  export function getMaxRetryDelay(): number {
    return Flag.MAX_RETRY_DELAY();
  }

  // Get retry timeout in milliseconds
  export function getRetryTimeout(): number {
    return Flag.RETRY_TIMEOUT() * 1000;
  }

  /**
   * Error thrown when retry-after exceeds AGENT_RETRY_TIMEOUT
   * This indicates the wait time is too long and we should fail immediately
   */
  export class RetryTimeoutExceededError extends Error {
    public readonly retryAfterMs: number;
    public readonly maxTimeoutMs: number;

    constructor(retryAfterMs: number, maxTimeoutMs: number) {
      const retryAfterHours = (retryAfterMs / 1000 / 3600).toFixed(2);
      const maxTimeoutHours = (maxTimeoutMs / 1000 / 3600).toFixed(2);
      super(
        `API returned retry-after of ${retryAfterHours} hours, which exceeds the maximum retry timeout of ${maxTimeoutHours} hours. ` +
          `Failing immediately instead of waiting. You can adjust AGENT_RETRY_TIMEOUT env var to increase the limit.`
      );
      this.name = 'RetryTimeoutExceededError';
      this.retryAfterMs = retryAfterMs;
      this.maxTimeoutMs = maxTimeoutMs;
    }
  }

  // Socket connection error retry configuration
  // Bun's fetch() has a known 10-second idle timeout issue
  // See: https://github.com/oven-sh/bun/issues/14439
  export const SOCKET_ERROR_MAX_RETRIES = 3;
  export const SOCKET_ERROR_INITIAL_DELAY = 1000; // 1 second
  export const SOCKET_ERROR_BACKOFF_FACTOR = 2;

  // Timeout error retry configuration
  // When API requests time out (AbortSignal.timeout), retry with increasing intervals
  // See: https://github.com/link-assistant/agent/issues/142
  export const TIMEOUT_MAX_RETRIES = 3;
  export const TIMEOUT_DELAYS = [30_000, 60_000, 120_000]; // 30s, 60s, 120s

  // Rate limit retry state tracking
  // Tracks total time spent retrying for each error type
  // See: https://github.com/link-assistant/agent/issues/157
  interface RetryState {
    errorType: string;
    startTime: number;
    totalRetryTime: number;
  }

  const retryStates: Map<string, RetryState> = new Map();

  /**
   * Check if we should continue retrying for a given session and error type.
   * Returns true if within retry timeout, false if exceeded.
   * The timeout resets when the error type changes.
   */
  export function shouldRetry(
    sessionID: string,
    errorType: string
  ): { shouldRetry: boolean; elapsedTime: number; maxTime: number } {
    const maxTime = Flag.RETRY_TIMEOUT() * 1000; // Convert to ms
    const state = retryStates.get(sessionID);

    if (!state || state.errorType !== errorType) {
      // New error type or first error - reset state
      retryStates.set(sessionID, {
        errorType,
        startTime: Date.now(),
        totalRetryTime: 0,
      });
      return { shouldRetry: true, elapsedTime: 0, maxTime };
    }

    const elapsedTime = Date.now() - state.startTime;
    if (elapsedTime >= maxTime) {
      log.info(() => ({
        message: 'retry timeout exceeded',
        sessionID,
        errorType,
        elapsedTime,
        maxTime,
      }));
      return { shouldRetry: false, elapsedTime, maxTime };
    }

    return { shouldRetry: true, elapsedTime, maxTime };
  }

  /**
   * Update retry state after a retry attempt.
   */
  export function updateRetryState(sessionID: string, delayMs: number): void {
    const state = retryStates.get(sessionID);
    if (state) {
      state.totalRetryTime += delayMs;
    }
  }

  /**
   * Clear retry state for a session (e.g., on success).
   */
  export function clearRetryState(sessionID: string): void {
    retryStates.delete(sessionID);
  }

  export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
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
   * Parse retry-after value from headers and return delay in milliseconds.
   * Returns null if no valid retry-after header is found.
   */
  function parseRetryAfterHeader(headers: Record<string, string>): number | null {
    // Check for retry-after-ms header first (milliseconds)
    const retryAfterMs = headers['retry-after-ms'];
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
    const retryAfter = headers['retry-after'];
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
   * Calculate retry delay based on error response headers and attempt number.
   *
   * RETRY LOGIC (per issue #157 requirements):
   * 1. If retry-after header is available:
   *    - If retry-after <= AGENT_RETRY_TIMEOUT: use it directly (exact time)
   *    - If retry-after > AGENT_RETRY_TIMEOUT: throw RetryTimeoutExceededError (fail immediately)
   * 2. If no retry-after header:
   *    - Use exponential backoff up to AGENT_MAX_RETRY_DELAY
   *
   * Adds jitter to prevent thundering herd when multiple requests retry.
   * See: https://github.com/link-assistant/agent/issues/157
   *
   * @throws {RetryTimeoutExceededError} When retry-after exceeds AGENT_RETRY_TIMEOUT
   */
  export function delay(error: MessageV2.APIError, attempt: number): number {
    const maxRetryTimeout = getRetryTimeout();
    const maxBackoffDelay = getMaxRetryDelay();
    const headers = error.data.responseHeaders;

    if (headers) {
      const retryAfterMs = parseRetryAfterHeader(headers);

      if (retryAfterMs !== null) {
        // Check if retry-after exceeds the maximum retry timeout
        if (retryAfterMs > maxRetryTimeout) {
          log.error(() => ({
            message: 'retry-after exceeds maximum retry timeout, failing immediately',
            retryAfterMs,
            maxRetryTimeout,
            retryAfterHours: (retryAfterMs / 1000 / 3600).toFixed(2),
            maxRetryTimeoutHours: (maxRetryTimeout / 1000 / 3600).toFixed(2),
          }));
          throw new RetryTimeoutExceededError(retryAfterMs, maxRetryTimeout);
        }

        // Use exact retry-after time (within timeout limit)
        log.info(() => ({
          message: 'using exact retry-after value',
          retryAfterMs,
          maxRetryTimeout,
        }));
        return addJitter(retryAfterMs);
      }

      // Headers present but no retry-after - use exponential backoff with max delay cap
      const backoffDelay = Math.min(
        RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
        maxBackoffDelay
      );
      log.info(() => ({
        message: 'no retry-after header, using exponential backoff',
        attempt,
        backoffDelay,
        maxBackoffDelay,
      }));
      return addJitter(backoffDelay);
    }

    // No headers at all - use exponential backoff with lower cap
    const backoffDelay = Math.min(
      RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
      RETRY_MAX_DELAY_NO_HEADERS
    );
    log.info(() => ({
      message: 'no response headers, using exponential backoff with conservative cap',
      attempt,
      backoffDelay,
      maxCap: RETRY_MAX_DELAY_NO_HEADERS,
    }));
    return addJitter(backoffDelay);
  }

  /**
   * Calculate delay for socket connection error retries.
   * Uses exponential backoff: 1s, 2s, 4s, etc.
   */
  export function socketErrorDelay(attempt: number): number {
    return (
      SOCKET_ERROR_INITIAL_DELAY *
      Math.pow(SOCKET_ERROR_BACKOFF_FACTOR, attempt - 1)
    );
  }

  /**
   * Calculate delay for timeout error retries.
   * Uses fixed intervals: 30s, 60s, 120s.
   * See: https://github.com/link-assistant/agent/issues/142
   */
  export function timeoutDelay(attempt: number): number {
    const index = Math.min(attempt - 1, TIMEOUT_DELAYS.length - 1);
    return TIMEOUT_DELAYS[index];
  }
}
