import { Log } from './log';
import { Flag } from '../flag/flag';

/**
 * Shared verbose HTTP fetch wrapper.
 *
 * Intercepts fetch() calls and logs request/response details as JSON objects
 * when --verbose mode is enabled. Used across the entire codebase (tools, auth,
 * config, providers) to ensure uniform and predictable HTTP logging.
 *
 * Features:
 * - Logs HTTP request: method, URL, sanitized headers, body preview
 * - Logs HTTP response: status, headers, duration, body preview
 * - Logs HTTP errors: stack trace, error cause chain
 * - Sequential call numbering for correlation
 * - Error-resilient: logging failures never break the actual HTTP request
 * - Runtime verbose check: respects Flag.OPENCODE_VERBOSE at call time
 *
 * @see https://github.com/link-assistant/agent/issues/215
 */

const log = Log.create({ service: 'http' });

/** Global call counter shared across all verbose fetch wrappers */
let globalHttpCallCount = 0;

/**
 * Sanitize HTTP headers by masking sensitive values.
 * Masks authorization, x-api-key, and api-key headers.
 */
export function sanitizeHeaders(
  rawHeaders: HeadersInit | Record<string, string> | Headers | undefined
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!rawHeaders) return sanitized;

  const entries =
    rawHeaders instanceof Headers
      ? Array.from(rawHeaders.entries())
      : Array.isArray(rawHeaders)
        ? rawHeaders
        : Object.entries(rawHeaders);

  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'api-key'
    ) {
      sanitized[key] =
        typeof value === 'string' && value.length > 8
          ? value.slice(0, 4) + '...' + value.slice(-4)
          : '[REDACTED]';
    } else {
      sanitized[key] = String(value);
    }
  }
  return sanitized;
}

/**
 * Create a body preview string, truncated to maxChars.
 */
export function bodyPreview(
  body: BodyInit | null | undefined,
  maxChars = 2000
): string | undefined {
  if (!body) return undefined;

  const bodyStr =
    typeof body === 'string'
      ? body
      : body instanceof ArrayBuffer || body instanceof Uint8Array
        ? `[binary ${(body as ArrayBuffer).byteLength ?? (body as Uint8Array).length} bytes]`
        : body instanceof URLSearchParams
          ? body.toString()
          : undefined;

  if (bodyStr && typeof bodyStr === 'string') {
    return bodyStr.length > maxChars
      ? bodyStr.slice(0, maxChars) +
          `... [truncated, total ${bodyStr.length} chars]`
      : bodyStr;
  }
  return undefined;
}

export interface VerboseFetchOptions {
  /** Identifier for the caller (e.g. 'webfetch', 'auth-plugins', 'config') */
  caller: string;
  /** Maximum chars for response body preview (default: 4000) */
  responseBodyMaxChars?: number;
  /** Maximum chars for request body preview (default: 2000) */
  requestBodyMaxChars?: number;
}

/**
 * Wrap a fetch function with verbose HTTP logging.
 *
 * When Flag.OPENCODE_VERBOSE is true, logs all HTTP requests and responses
 * as JSON objects. When verbose is false, returns a no-op passthrough.
 *
 * All logging is wrapped in try/catch so it never breaks the actual HTTP request.
 *
 * @param innerFetch - The fetch function to wrap (defaults to global fetch)
 * @param options - Configuration for the wrapper
 * @returns A wrapped fetch function with verbose logging
 */
export function createVerboseFetch(
  innerFetch: typeof fetch = fetch,
  options: VerboseFetchOptions
): typeof fetch {
  const {
    caller,
    responseBodyMaxChars = 4000,
    requestBodyMaxChars = 2000,
  } = options;

  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Check verbose flag at call time
    if (!Flag.OPENCODE_VERBOSE) {
      return innerFetch(input, init);
    }

    globalHttpCallCount++;
    const callNum = globalHttpCallCount;

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? 'GET';

    // Prepare request details for logging (error-resilient)
    let sanitizedHdrs: Record<string, string> = {};
    let reqBodyPreview: string | undefined;
    try {
      sanitizedHdrs = sanitizeHeaders(init?.headers as HeadersInit | undefined);
      reqBodyPreview = bodyPreview(init?.body, requestBodyMaxChars);
    } catch (prepError) {
      log.warn('verbose logging: failed to prepare request details', {
        caller,
        error:
          prepError instanceof Error ? prepError.message : String(prepError),
      });
    }

    // Log request
    log.info('HTTP request', {
      caller,
      callNum,
      method,
      url,
      headers: sanitizedHdrs,
      bodyPreview: reqBodyPreview,
    });

    const startMs = Date.now();
    try {
      const response = await innerFetch(input, init);
      const durationMs = Date.now() - startMs;

      // Log response
      try {
        log.info('HTTP response', {
          caller,
          callNum,
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        });
      } catch {
        // Ignore logging errors
      }

      // Log response body
      const contentType = response.headers.get('content-type') ?? '';
      const isStreaming =
        contentType.includes('event-stream') ||
        contentType.includes('octet-stream');

      if (response.body) {
        try {
          if (isStreaming) {
            const [sdkStream, logStream] = response.body.tee();

            // Consume log stream asynchronously
            (async () => {
              try {
                const reader = logStream.getReader();
                const decoder = new TextDecoder();
                let preview = '';
                let truncated = false;
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!truncated) {
                    const chunk = decoder.decode(value, { stream: true });
                    preview += chunk;
                    if (preview.length > responseBodyMaxChars) {
                      preview = preview.slice(0, responseBodyMaxChars);
                      truncated = true;
                    }
                  }
                }
                log.info('HTTP response body (stream)', {
                  caller,
                  callNum,
                  url,
                  bodyPreview: truncated
                    ? preview + `... [truncated]`
                    : preview,
                });
              } catch {
                // Ignore logging errors
              }
            })();

            return new Response(sdkStream, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          } else {
            const bodyText = await response.text();
            const preview =
              bodyText.length > responseBodyMaxChars
                ? bodyText.slice(0, responseBodyMaxChars) +
                  `... [truncated, total ${bodyText.length} chars]`
                : bodyText;
            log.info('HTTP response body', {
              caller,
              callNum,
              url,
              bodyPreview: preview,
            });
            return new Response(bodyText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
        } catch {
          // If body logging fails, return original response
          return response;
        }
      }

      return response;
    } catch (error) {
      const durationMs = Date.now() - startMs;
      try {
        log.error('HTTP request failed', {
          caller,
          callNum,
          method,
          url,
          durationMs,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                  cause:
                    error.cause instanceof Error
                      ? error.cause.message
                      : error.cause
                        ? String(error.cause)
                        : undefined,
                }
              : String(error),
        });
      } catch {
        // Ignore logging errors
      }
      throw error;
    }
  };
}

/**
 * Get the current global HTTP call count (for testing).
 */
export function getHttpCallCount(): number {
  return globalHttpCallCount;
}

/**
 * Reset the global HTTP call count (for testing).
 */
export function resetHttpCallCount(): void {
  globalHttpCallCount = 0;
}
