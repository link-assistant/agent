import { test, expect, describe } from 'bun:test';

/**
 * Unit tests for verbose HTTP request/response logging logic.
 *
 * Issue #200: Models not working — insufficient debug output.
 * When --verbose is enabled, all HTTP requests to LLM providers should be
 * logged as JSON with request URL, method, sanitized headers, body preview,
 * response status, and timing.
 *
 * These tests verify the logging logic in isolation without spawning the full CLI.
 *
 * @see https://github.com/link-assistant/agent/issues/200
 */

describe('Verbose HTTP logging - header sanitization', () => {
  /**
   * Sanitize headers logic extracted from provider.ts getSDK verbose logging.
   * This mirrors the exact logic used in production.
   */
  function sanitizeHeaders(
    rawHeaders: Record<string, string>
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawHeaders)) {
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

  test('masks long authorization header values', () => {
    const headers = {
      Authorization: 'Bearer sk-abcdefgh12345678',
      'Content-Type': 'application/json',
    };
    const result = sanitizeHeaders(headers);
    expect(result['Authorization']).toBe('Bear...5678');
    expect(result['Content-Type']).toBe('application/json');
    expect(result['Authorization']).not.toContain('sk-abcdefgh12345678');
  });

  test('masks x-api-key header', () => {
    const headers = {
      'x-api-key': 'sk-super-secret-key-12345',
    };
    const result = sanitizeHeaders(headers);
    expect(result['x-api-key']).toBe('sk-s...2345');
    expect(result['x-api-key']).not.toContain('sk-super-secret-key-12345');
  });

  test('masks api-key header (Azure style)', () => {
    const headers = {
      'api-key': 'my-azure-api-key-value-xyz',
    };
    const result = sanitizeHeaders(headers);
    expect(result['api-key']).toBe('my-a...-xyz');
  });

  test('redacts short API keys entirely', () => {
    const headers = {
      Authorization: 'short',
    };
    const result = sanitizeHeaders(headers);
    expect(result['Authorization']).toBe('[REDACTED]');
  });

  test('preserves non-sensitive headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'opencode-agent/1.0',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    };
    const result = sanitizeHeaders(headers);
    expect(result['Content-Type']).toBe('application/json');
    expect(result['User-Agent']).toBe('opencode-agent/1.0');
    expect(result['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
  });
});

describe('Verbose HTTP logging - body preview truncation', () => {
  function getBodyPreview(
    body: string | undefined,
    maxLength = 2000
  ): string | undefined {
    if (!body) return undefined;
    if (body.length > maxLength) {
      return (
        body.slice(0, maxLength) +
        `... [truncated, total ${body.length} chars]`
      );
    }
    return body;
  }

  test('returns short body as-is', () => {
    const body = '{"model":"gemini-3-pro","messages":[]}';
    expect(getBodyPreview(body)).toBe(body);
  });

  test('truncates long body with size info', () => {
    const body = 'x'.repeat(5000);
    const preview = getBodyPreview(body);
    expect(preview).toContain('... [truncated, total 5000 chars]');
    expect(preview!.length).toBeLessThan(5000);
  });

  test('returns undefined for undefined body', () => {
    expect(getBodyPreview(undefined)).toBeUndefined();
  });
});

describe('Model not found - available models suggestion', () => {
  test('suggestion message includes available models', () => {
    const modelID = 'non-existent-model';
    const providerID = 'google';
    const availableModels = [
      'gemini-3-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ];

    const suggestion = `Model "${modelID}" not found in provider "${providerID}". Available models: ${availableModels.join(', ')}${availableModels.length > 10 ? ` (and ${availableModels.length - 10} more)` : ''}.`;

    expect(suggestion).toContain('non-existent-model');
    expect(suggestion).toContain('google');
    expect(suggestion).toContain('gemini-3-pro-preview');
    expect(suggestion).toContain('gemini-2.5-flash');
  });

  test('suggestion message handles large model lists', () => {
    const models = Array.from({ length: 15 }, (_, i) => `model-${i}`);
    const displayed = models.slice(0, 10);
    const suggestion = `Available models: ${displayed.join(', ')}${models.length > 10 ? ` (and ${models.length - 10} more)` : ''}.`;

    expect(suggestion).toContain('model-0');
    expect(suggestion).toContain('model-9');
    expect(suggestion).toContain('(and 5 more)');
    expect(suggestion).not.toContain('model-10');
  });
});

describe('Rate limit detection', () => {
  function isRateLimitError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('ratelimit') ||
      message.includes('too many requests') ||
      message.includes('429') ||
      name.includes('ratelimit')
    );
  }

  test('detects rate limit by message', () => {
    expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('Too many requests'))).toBe(true);
    expect(isRateLimitError(new Error('HTTP 429: rate limited'))).toBe(true);
  });

  test('detects rate limit by error name', () => {
    const err = new Error('limit reached');
    err.name = 'RateLimitError';
    expect(isRateLimitError(err)).toBe(true);
  });

  test('does not detect non-rate-limit errors', () => {
    expect(isRateLimitError(new Error('Connection timeout'))).toBe(false);
    expect(isRateLimitError(new Error('Internal server error'))).toBe(false);
    expect(isRateLimitError('not an error')).toBe(false);
  });
});

describe('Model parsing', () => {
  function parseModel(model: string) {
    const [providerID, ...rest] = model.split('/');
    return {
      providerID,
      modelID: rest.join('/'),
    };
  }

  test('parses provider/model format', () => {
    expect(parseModel('google/gemini-3-pro')).toEqual({
      providerID: 'google',
      modelID: 'gemini-3-pro',
    });
  });

  test('parses provider/nested/model format', () => {
    expect(parseModel('kilo/z-ai/glm-5:free')).toEqual({
      providerID: 'kilo',
      modelID: 'z-ai/glm-5:free',
    });
  });

  test('handles model without provider', () => {
    expect(parseModel('glm-5-free')).toEqual({
      providerID: 'glm-5-free',
      modelID: '',
    });
  });
});
