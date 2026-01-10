import { iife } from '../util/iife';
import { MessageV2 } from './message-v2';

export namespace SessionRetry {
  export const RETRY_INITIAL_DELAY = 2000;
  export const RETRY_BACKOFF_FACTOR = 2;
  export const RETRY_MAX_DELAY_NO_HEADERS = 30_000; // 30 seconds

  // Socket connection error retry configuration
  // Bun's fetch() has a known 10-second idle timeout issue
  // See: https://github.com/oven-sh/bun/issues/14439
  export const SOCKET_ERROR_MAX_RETRIES = 3;
  export const SOCKET_ERROR_INITIAL_DELAY = 1000; // 1 second
  export const SOCKET_ERROR_BACKOFF_FACTOR = 2;

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

  export function delay(error: MessageV2.APIError, attempt: number) {
    const headers = error.data.responseHeaders;
    if (headers) {
      const retryAfterMs = headers['retry-after-ms'];
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs);
        if (!Number.isNaN(parsedMs)) {
          return parsedMs;
        }
      }

      const retryAfter = headers['retry-after'];
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter);
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return Math.ceil(parsedSeconds * 1000);
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now();
        if (!Number.isNaN(parsed) && parsed > 0) {
          return Math.ceil(parsed);
        }
      }

      return RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1);
    }

    return Math.min(
      RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
      RETRY_MAX_DELAY_NO_HEADERS
    );
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
}
