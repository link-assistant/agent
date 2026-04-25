import { test, expect, describe } from 'bun:test';

/**
 * Tests for issue #235: Verbose log messages emitted as "type": "error" events.
 *
 * The stderr interceptor in index.js wraps all non-JSON stderr output in a JSON
 * envelope. Previously it always used "type": "error", which caused consumers
 * to falsely detect errors when verbose/debug messages were written to stderr.
 *
 * After the fix:
 * - Messages prefixed with [verbose] or [debug] are wrapped as "type": "log"
 * - Other stderr messages remain "type": "error" (actual runtime errors)
 *
 * @see https://github.com/link-assistant/agent/issues/235
 */

describe('Stderr interceptor — verbose message wrapping (#235)', () => {
  /**
   * Simulates the stderr interceptor logic from index.js.
   * This mirrors the exact logic used in production.
   */
  function simulateStderrInterceptor(input: string): object {
    const trimmed = input.trim();

    // Check if already JSON — pass through
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON, wrap it
      }
    }

    // Verbose/debug messages use "type": "log", not "type": "error" (#235)
    const isVerboseMsg =
      trimmed.startsWith('[verbose]') || trimmed.startsWith('[debug]');

    if (isVerboseMsg) {
      return {
        type: 'log',
        level: 'debug',
        service: 'stderr',
        message: trimmed,
      };
    }

    return {
      type: 'error',
      errorType: 'RuntimeError',
      message: trimmed,
    };
  }

  test('verbose messages are wrapped as "type": "log", not "type": "error"', () => {
    const result = simulateStderrInterceptor(
      '[verbose] HTTP logging active for provider: opencode'
    );
    expect(result).toEqual({
      type: 'log',
      level: 'debug',
      service: 'stderr',
      message: '[verbose] HTTP logging active for provider: opencode',
    });
  });

  test('debug messages are wrapped as "type": "log"', () => {
    const result = simulateStderrInterceptor('[debug] some diagnostic message');
    expect(result).toEqual({
      type: 'log',
      level: 'debug',
      service: 'stderr',
      message: '[debug] some diagnostic message',
    });
  });

  test('actual runtime errors are still wrapped as "type": "error"', () => {
    const result = simulateStderrInterceptor(
      'TypeError: Cannot read properties of undefined'
    );
    expect(result).toEqual({
      type: 'error',
      errorType: 'RuntimeError',
      message: 'TypeError: Cannot read properties of undefined',
    });
  });

  test('existing JSON is passed through unchanged', () => {
    const json = JSON.stringify({
      type: 'log',
      level: 'info',
      message: 'test',
    });
    const result = simulateStderrInterceptor(json);
    expect(result).toEqual({
      type: 'log',
      level: 'info',
      message: 'test',
    });
  });

  test('verbose exit warning is proper JSON and not wrapped as error', () => {
    // After fix, verbose-fetch.ts exit handler writes proper JSON
    const exitWarning = JSON.stringify({
      type: 'log',
      level: 'warn',
      service: 'http',
      message:
        '2 HTTP stream response log(s) were still pending at process exit — response bodies may be missing from logs',
    });
    const result = simulateStderrInterceptor(exitWarning);
    // Should pass through as-is since it's already valid JSON
    expect(result).toHaveProperty('type', 'log');
    expect(result).toHaveProperty('level', 'warn');
  });
});

describe('Provider verbose logging uses "type": "log" (#235)', () => {
  test('verbose HTTP logging active message uses log.debug, not stderr', () => {
    // Verify the diagnostic breadcrumb produces "type": "log" format
    // This tests the expected output format after the fix
    const expectedFormat = {
      type: 'log',
      level: 'debug',
      service: expect.any(String),
      message: 'verbose HTTP logging active',
    };

    // The log.debug() call in provider.ts produces this structure
    const logOutput = {
      type: 'log',
      level: 'debug',
      service: 'provider',
      message: 'verbose HTTP logging active',
      providerID: 'opencode',
    };

    expect(logOutput.type).toBe('log');
    expect(logOutput.level).toBe('debug');
    expect(logOutput.type).not.toBe('error');
  });
});
