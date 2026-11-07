import path from 'path';
import { NoSuchModelError, type LanguageModel, type Provider as SDK } from 'ai';
import { Log } from '../util/log';
import { BunProc } from '../bun';
import { ModelsDev } from './models';
import { config, isVerbose } from '../config/config';
import { RetryFetch } from './retry-fetch';
import { SSEUsageExtractor } from '../util/sse-usage-extractor';
import { sanitizeUrl } from '../util/verbose-fetch';
import { EnvTemplate } from './env-template';
import { Provider } from './provider';
import { BUNDLED_PROVIDERS } from './provider-loaders';
const log = Log.create({ service: 'provider' });

export async function getSDK(
  provider: ModelsDev.Provider,
  model: ModelsDev.Model
) {
  return (async () => {
    using _ = log.time('getSDK', {
      providerID: provider.id,
    });
    const s = await Provider.state();
    const pkg = model.provider?.npm ?? provider.npm ?? provider.id;
    const entry = s.providers[provider.id];
    let options: Record<string, any> = { ...entry?.options };
    // Per-model endpoint from models.dev (Vertex partner models, Bedrock
    // Mantle, Cloudflare passthrough routes). A user-set baseURL still wins
    // for models served by the provider's own package (#334).
    const providerURL = EnvTemplate.resolve(provider.api);
    const modelURL = EnvTemplate.resolve(model.provider?.api);
    const ownPackage = !model.provider?.npm || pkg === provider.npm;
    if (
      modelURL &&
      /^https?:\/\//.test(modelURL) &&
      (!ownPackage || !options['baseURL'] || options['baseURL'] === providerURL)
    ) {
      options['baseURL'] = modelURL;
    }
    const template = model.provider?.api ?? provider.api;
    if (
      !options['baseURL'] &&
      EnvTemplate.isTemplate(template) &&
      !EnvTemplate.resolve(template)
    ) {
      const missing = EnvTemplate.variables(template).filter(
        (name) => !EnvTemplate.resolve(`\${${name}}`)
      );
      throw new Error(
        `Provider "${provider.id}" needs ${missing.join(', ')} to build its base URL (${template}). ` +
          `Set the environment variable(s) or provider.${provider.id}.options.baseURL in the config.`
      );
    }
    if (entry?.sdkOptions) options = entry.sdkOptions(pkg, options);
    if (
      pkg.includes('@ai-sdk/openai-compatible') &&
      options['includeUsage'] === undefined
    ) {
      options['includeUsage'] = true;
    }
    const key = Bun.hash.xxHash32(JSON.stringify({ pkg, options }));
    const existing = s.sdk.get(key);
    if (existing) return existing;

    // Apply timeout wrapper to options if timeout is specified
    if (options['timeout'] !== undefined && options['timeout'] !== null) {
      // Preserve custom fetch if it exists, wrap it with timeout logic
      const customFetch = options['fetch'];
      options['fetch'] = async (input: any, init?: BunFetchRequestInit) => {
        const { signal, ...rest } = init ?? {};

        const signals: AbortSignal[] = [];
        if (signal) signals.push(signal);
        if (options['timeout'] !== false)
          signals.push(AbortSignal.timeout(options['timeout']));

        const combined =
          signals.length > 1 ? AbortSignal.any(signals) : signals[0];

        const fetchFn = customFetch ?? fetch;
        return fetchFn(input, {
          ...rest,
          signal: combined,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        });
      };
    }

    // Wrap fetch with retry logic for rate limit handling (HTTP 429)
    // This ensures the agent's time-based retry (7-week timeout) is respected
    // instead of the AI SDK's fixed retry count (3 attempts)
    // See: https://github.com/link-assistant/agent/issues/167
    const existingFetch = options['fetch'] ?? fetch;
    options['fetch'] = RetryFetch.wrap(existingFetch, {
      sessionID: provider.id,
    });

    // Verbose HTTP logging for provider API calls.
    // This provider-level wrapper logs HTTP requests/responses independently
    // of the global fetch monkey-patch. Both mechanisms are kept active to
    // maximize HTTP observability — the global patch may miss calls if the
    // AI SDK captures/resolves fetch references before it is installed,
    // while this wrapper is injected directly into the SDK's fetch option.
    // See: https://github.com/link-assistant/agent/issues/221
    // See: https://github.com/link-assistant/agent/issues/217
    // See: https://github.com/link-assistant/agent/issues/215
    {
      const innerFetch = options['fetch'];
      let verboseWrapperConfirmed = false;
      let httpCallCount = 0;

      log.info('provider SDK fetch chain configured', {
        providerID: provider.id,
        pkg,
        globalVerboseFetchInstalled: !!globalThis.__agentVerboseFetchInstalled,
        verboseAtCreation: isVerbose(),
      });

      options['fetch'] = async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        // Check verbose flag at call time — not at SDK creation time.
        // Uses isVerbose() with env var fallback for resilience against
        // flag state loss in subprocess/module-reload scenarios.
        // See: https://github.com/link-assistant/agent/issues/206
        // See: https://github.com/link-assistant/agent/issues/227
        // Even when verbose mode is off, intercept streaming responses
        // to extract usage tokens from raw SSE data. This is critical for
        // recovering usage when the AI SDK drops it from finish-step events.
        // @see https://github.com/link-assistant/agent/issues/249
        if (!isVerbose()) {
          const response = await innerFetch(input, init);
          const ct = response.headers.get('content-type') ?? '';
          const isSSE =
            ct.includes('event-stream') || ct.includes('octet-stream');
          if (isSSE && response.body) {
            const [sdkStream, usageStream] = response.body.tee();
            const sseReqId = SSEUsageExtractor.nextRequestId();
            (async () => {
              const reader = usageStream.getReader();
              try {
                // Read the whole branch: a tee branch that stops being read
                // keeps buffering the rest of the response (issue #335).
                const decoder = new TextDecoder();
                const tracker = SSEUsageExtractor.createTracker();
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  tracker.push(decoder.decode(value, { stream: true }));
                }
                tracker.push(decoder.decode());
                const usage = tracker.finish();
                if (usage) SSEUsageExtractor.storeUsage(sseReqId, usage);
              } catch {
                // Never break the SDK stream; release the branch instead.
                reader.cancel().catch(() => {});
              }
            })();
            return new Response(sdkStream, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
          return response;
        }

        httpCallCount++;
        const callNum = httpCallCount;

        // Log a one-time confirmation that the verbose wrapper is active for this provider.
        // This diagnostic breadcrumb confirms the wrapper is in the fetch chain.
        // See: https://github.com/link-assistant/agent/issues/215
        // See: https://github.com/link-assistant/agent/issues/235
        if (!verboseWrapperConfirmed) {
          verboseWrapperConfirmed = true;
          log.debug('verbose HTTP logging active', {
            providerID: provider.id,
          });
        }

        // Logged only; query-string credentials are masked (issue #335).
        const url = sanitizeUrl(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        );
        const method = init?.method ?? 'GET';

        // Wrap all verbose logging in try/catch so it never breaks the actual HTTP request.
        // If logging fails, the request must still proceed — logging is observability, not control flow.
        // See: https://github.com/link-assistant/agent/issues/215
        let sanitizedHeaders: Record<string, string> = {};
        let bodyPreview: string | undefined;
        try {
          // Sanitize headers - mask authorization values
          const rawHeaders = init?.headers;
          if (rawHeaders) {
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
                sanitizedHeaders[key] =
                  typeof value === 'string' && value.length > 8
                    ? value.slice(0, 4) + '...' + value.slice(-4)
                    : '[REDACTED]';
              } else {
                sanitizedHeaders[key] = String(value);
              }
            }
          }

          // Log request body preview (truncated)
          if (init?.body) {
            const bodyStr =
              typeof init.body === 'string'
                ? init.body
                : init.body instanceof ArrayBuffer ||
                    init.body instanceof Uint8Array
                  ? `[binary ${(init.body as ArrayBuffer).byteLength ?? (init.body as Uint8Array).length} bytes]`
                  : undefined;
            if (bodyStr && typeof bodyStr === 'string') {
              bodyPreview =
                bodyStr.length > 200000
                  ? bodyStr.slice(0, 200000) +
                    `... [truncated, total ${bodyStr.length} chars]`
                  : bodyStr;
            }
          }
        } catch (prepError) {
          // If header/body processing fails, log the error but continue with the request
          log.warn('verbose logging: failed to prepare request details', {
            providerID: provider.id,
            error:
              prepError instanceof Error
                ? prepError.message
                : String(prepError),
          });
        }

        // Use direct (non-lazy) logging for HTTP request/response to ensure output
        // is not lost when piped through external process wrappers (e.g., solve.mjs).
        // The verbose check is already done above, so lazy evaluation is not needed here.
        // See: https://github.com/link-assistant/agent/issues/211
        log.info('HTTP request', {
          caller: `provider/${provider.id}`,
          providerID: provider.id,
          callNum,
          method,
          url,
          headers: sanitizedHeaders,
          bodyPreview,
        });

        const startMs = Date.now();
        try {
          // Pass Bun-specific verbose:true to get detailed connection debugging
          // (prints request/response headers to stderr on socket errors).
          // This is a no-op on non-Bun runtimes.
          // See: https://bun.sh/docs/api/fetch
          // See: https://github.com/link-assistant/agent/issues/215
          const verboseInit = { ...init, verbose: true } as RequestInit;
          const response = await innerFetch(input, verboseInit);
          const durationMs = Date.now() - startMs;

          // Use direct (non-lazy) logging to ensure HTTP response details are captured
          // See: https://github.com/link-assistant/agent/issues/211
          log.info('HTTP response', {
            caller: `provider/${provider.id}`,
            providerID: provider.id,
            callNum,
            method,
            url,
            status: response.status,
            statusText: response.statusText,
            durationMs,
            responseHeaders: Object.fromEntries(response.headers.entries()),
          });

          // Log response body for debugging provider failures
          // For streaming responses (SSE/event-stream), tee() the stream so the AI SDK
          // still receives the full stream while we asynchronously log a preview.
          // For non-streaming responses, buffer the body and reconstruct the Response.
          // See: https://github.com/link-assistant/agent/issues/204
          const responseBodyMaxChars = 200000;
          const contentType = response.headers.get('content-type') ?? '';
          const isStreaming =
            contentType.includes('event-stream') ||
            contentType.includes('octet-stream');

          if (response.body) {
            if (isStreaming) {
              // Tee the stream: one copy for AI SDK, one for logging
              const [sdkStream, logStream] = response.body.tee();

              // Consume log stream asynchronously (does not block SDK)
              // Also extract usage tokens from raw SSE data as fallback
              // for when the AI SDK drops usage from its finish-step event.
              // @see https://github.com/link-assistant/agent/issues/249
              const sseRequestId = SSEUsageExtractor.nextRequestId();
              (async () => {
                try {
                  const reader = logStream.getReader();
                  const decoder = new TextDecoder();
                  const tracker = SSEUsageExtractor.createTracker();
                  let bodyPreview = '';
                  let truncated = false;
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value, { stream: true });
                    tracker.push(chunk);
                    if (!truncated) {
                      bodyPreview += chunk;
                      if (bodyPreview.length > responseBodyMaxChars) {
                        bodyPreview = bodyPreview.slice(
                          0,
                          responseBodyMaxChars
                        );
                        truncated = true;
                      }
                    }
                  }
                  // Extract usage from the whole raw SSE stream (not just
                  // the logged preview) as AI SDK fallback.
                  tracker.push(decoder.decode());
                  const usage = tracker.finish();
                  if (usage) SSEUsageExtractor.storeUsage(sseRequestId, usage);
                  // Use direct (non-lazy) logging for stream body
                  // See: https://github.com/link-assistant/agent/issues/211
                  log.info('HTTP response body (stream)', {
                    caller: `provider/${provider.id}`,
                    providerID: provider.id,
                    callNum,
                    url,
                    sseRequestId,
                    bodyPreview: truncated
                      ? bodyPreview + `... [truncated]`
                      : bodyPreview,
                  });
                } catch {
                  // Ignore logging errors — do not affect the SDK stream
                }
              })();

              // Return response with the SDK's copy of the stream
              return new Response(sdkStream, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            } else {
              // Non-streaming: buffer body, log it, reconstruct Response
              const bodyText = await response.text();
              const bodyPreview =
                bodyText.length > responseBodyMaxChars
                  ? bodyText.slice(0, responseBodyMaxChars) +
                    `... [truncated, total ${bodyText.length} chars]`
                  : bodyText;
              // Use direct (non-lazy) logging for non-streaming body
              // See: https://github.com/link-assistant/agent/issues/211
              log.info('HTTP response body', {
                caller: `provider/${provider.id}`,
                providerID: provider.id,
                callNum,
                url,
                bodyPreview,
              });
              return new Response(bodyText, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            }
          }

          return response;
        } catch (error) {
          const durationMs = Date.now() - startMs;
          // Use direct (non-lazy) logging for error path
          // Include stack trace and error cause for better debugging of socket errors
          // See: https://github.com/link-assistant/agent/issues/211
          // See: https://github.com/link-assistant/agent/issues/215
          log.error('HTTP request failed', {
            caller: `provider/${provider.id}`,
            providerID: provider.id,
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
          throw error;
        }
      };
    }

    // Check if we have a bundled provider first - this avoids runtime package installation
    // which can hang or timeout due to known Bun issues
    // @see https://github.com/link-assistant/agent/issues/173
    // @see https://github.com/oven-sh/bun/issues/5831
    const bundledFn = BUNDLED_PROVIDERS[pkg];
    if (bundledFn) {
      log.info(() => ({
        message: 'using bundled provider (no installation needed)',
        providerID: provider.id,
        pkg,
      }));
      const loaded = bundledFn({
        name: provider.id,
        ...options,
      });
      s.sdk.set(key, loaded);
      return loaded as SDK;
    }

    // Fall back to dynamic installation for non-bundled providers
    let installedPath: string;
    if (!pkg.startsWith('file://')) {
      log.info(() => ({
        message: 'installing provider package (not bundled)',
        providerID: provider.id,
        pkg,
        version: 'latest',
      }));
      installedPath = await BunProc.install(pkg, 'latest');
      log.info(() => ({
        message: 'provider package installed successfully',
        providerID: provider.id,
        pkg,
        installedPath,
      }));
    } else {
      log.info(() => ({ message: 'loading local provider', pkg }));
      installedPath = pkg;
    }

    // `@ai-sdk/google-vertex/anthropic` and other subpath packages are
    // bundled above, so no dist path patching is needed here (#334).
    const mod = await import(installedPath);

    const fn = mod[Object.keys(mod).find((key) => key.startsWith('create'))!];
    const loaded = fn({
      name: provider.id,
      ...options,
    });
    s.sdk.set(key, loaded);
    return loaded as SDK;
  })().catch((e) => {
    log.error(() => ({
      message: 'provider initialization failed',
      providerID: provider.id,
      pkg: model.provider?.npm ?? provider.npm ?? provider.id,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      cause: e instanceof Error && e.cause ? String(e.cause) : undefined,
    }));
    throw new Provider.InitError({ providerID: provider.id }, { cause: e });
  });
}
