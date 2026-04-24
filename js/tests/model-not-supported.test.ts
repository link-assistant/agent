import { test, expect, describe } from 'bun:test';
import { SessionProcessor } from '../src/session/processor.ts';

/**
 * Unit tests for model-not-supported error detection in processor.ts.
 *
 * Issue #208: When the OpenCode provider returns HTTP 401 with a body like
 * {"type":"error","error":{"type":"ModelError","message":"Model X not supported"}}
 * the error looks like an authentication failure but is actually a
 * model-availability issue (stale cache, model removed by provider).
 *
 * These tests verify that isModelNotSupportedError() correctly identifies
 * the ModelError pattern and does not false-positive on real auth errors.
 *
 * @see https://github.com/link-assistant/agent/issues/208
 */

describe('isModelNotSupportedError (#208)', () => {
  // --- OpenCode / OpenRouter nested format ---

  test('detects OpenCode nested ModelError format', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'ModelError',
        message: 'Model kimi-k2.5-free not supported',
      },
    });
    expect(SessionProcessor.isModelNotSupportedError(body)).toBe(true);
  });

  test('detects flat ModelError format', () => {
    const body = JSON.stringify({
      type: 'ModelError',
      message: 'Model not available',
    });
    expect(SessionProcessor.isModelNotSupportedError(body)).toBe(true);
  });

  // --- Real auth errors should NOT be flagged ---

  test('does NOT flag real 401 auth errors', () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'AuthError',
        message: 'Invalid API key',
      },
    });
    expect(SessionProcessor.isModelNotSupportedError(body)).toBe(false);
  });

  test('does NOT flag empty JSON object', () => {
    expect(SessionProcessor.isModelNotSupportedError('{}')).toBe(false);
  });

  test('does NOT flag plain auth error text', () => {
    expect(SessionProcessor.isModelNotSupportedError('Unauthorized')).toBe(
      false
    );
  });

  // --- Text fallback patterns ---

  test('detects "ModelError" in plain text response', () => {
    expect(
      SessionProcessor.isModelNotSupportedError(
        'Error: ModelError: Model not available'
      )
    ).toBe(true);
  });

  test('detects case-insensitive "model not supported" in plain text', () => {
    expect(
      SessionProcessor.isModelNotSupportedError(
        'Model not supported: kimi-k2.5-free'
      )
    ).toBe(true);
  });

  test('detects case-insensitive "model not found" in plain text', () => {
    expect(
      SessionProcessor.isModelNotSupportedError(
        'Model not found: kimi-k2.5-free'
      )
    ).toBe(true);
  });

  // --- Edge cases ---

  test('handles invalid JSON gracefully', () => {
    // Should fall back to text pattern matching
    expect(SessionProcessor.isModelNotSupportedError('{')).toBe(false);
    expect(
      SessionProcessor.isModelNotSupportedError(
        '{ broken json with ModelError text'
      )
    ).toBe(true);
  });

  test('handles empty string', () => {
    expect(SessionProcessor.isModelNotSupportedError('')).toBe(false);
  });

  test('handles JSON with different error types', () => {
    const rateLimitBody = JSON.stringify({
      type: 'error',
      error: {
        type: 'RateLimitError',
        message: 'Rate limit exceeded',
      },
    });
    expect(SessionProcessor.isModelNotSupportedError(rateLimitBody)).toBe(
      false
    );
  });
});

describe('isUsageDataTypeError (#264)', () => {
  test('detects Bun-style usage.inputTokens.total TypeError from provider stream failure', () => {
    const error = new TypeError(
      "undefined is not an object (evaluating 'usage.inputTokens.total')"
    );

    expect(SessionProcessor.isUsageDataTypeError(error)).toBe(true);
  });

  test('detects Node-style inputTokens.total TypeError', () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'total'): usage.inputTokens.total"
    );

    expect(SessionProcessor.isUsageDataTypeError(error)).toBe(true);
  });

  test('keeps existing snake_case usage detection', () => {
    const error = new TypeError(
      "Cannot read properties of undefined (reading 'input_tokens')"
    );

    expect(SessionProcessor.isUsageDataTypeError(error)).toBe(true);
  });

  test('does not classify unrelated TypeErrors as usage data errors', () => {
    expect(
      SessionProcessor.isUsageDataTypeError(
        new TypeError("Cannot read properties of undefined (reading 'foo')")
      )
    ).toBe(false);
  });
});
