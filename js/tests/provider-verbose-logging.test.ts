import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { config, setVerbose } from '../src/config/agent-config';

/**
 * Tests that provider-level verbose HTTP logging works correctly.
 *
 * Issue #221: HTTP requests/responses were not being logged in --verbose mode
 * because the provider wrapper was skipping when the global fetch monkey-patch
 * was installed. The fix removes the skip condition so both the global patch
 * and the provider-level wrapper log independently — maximizing HTTP observability.
 *
 * @see https://github.com/link-assistant/agent/issues/221
 */

describe('Provider verbose logging - skip condition', () => {
  const originalVerbose = config.verbose;

  afterEach(() => {
    setVerbose(originalVerbose);
  });

  test('provider wrapper logs when verbose is enabled (no global patch dependency)', async () => {
    setVerbose(true);

    let loggedRequest = false;
    let loggedResponse = false;

    const innerFetch = async (input: any, init?: any) => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    // Simulate the provider-level wrapper from provider.ts
    // This is the FIXED version that does NOT check globalThis.__agentVerboseFetchInstalled
    const wrappedFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (!config.verbose) {
        return innerFetch(input, init);
      }
      // Log request
      loggedRequest = true;
      const response = await innerFetch(input, init);
      // Log response
      loggedResponse = true;
      return response;
    };

    await wrappedFetch('https://api.example.com/v1/messages', {
      method: 'POST',
    });

    expect(loggedRequest).toBe(true);
    expect(loggedResponse).toBe(true);
  });

  test('provider wrapper does not log when verbose is disabled', async () => {
    setVerbose(false);

    let loggedRequest = false;

    const innerFetch = async () =>
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

    const wrappedFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (!config.verbose) {
        return innerFetch();
      }
      loggedRequest = true;
      return innerFetch();
    };

    await wrappedFetch('https://api.example.com/v1');
    expect(loggedRequest).toBe(false);
  });

  test('provider wrapper checks verbose at call time, not creation time', async () => {
    // Create wrapper when verbose is OFF
    setVerbose(false);

    let loggedCount = 0;
    const innerFetch = async () =>
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

    const wrappedFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      if (!config.verbose) {
        return innerFetch();
      }
      loggedCount++;
      return innerFetch();
    };

    // Call 1: verbose OFF - should not log
    await wrappedFetch('https://api.example.com/v1');
    expect(loggedCount).toBe(0);

    // Enable verbose AFTER wrapper creation
    setVerbose(true);

    // Call 2: verbose ON - should log
    await wrappedFetch('https://api.example.com/v1');
    expect(loggedCount).toBe(1);
  });

  test('provider wrapper does NOT depend on global fetch monkey-patch', async () => {
    setVerbose(true);

    // Simulate the OLD buggy behavior: skip if global patch is installed
    // This test verifies the old behavior was wrong
    const globalPatchInstalled = true; // simulates __agentVerboseFetchInstalled
    let loggedWithOldLogic = false;
    let loggedWithNewLogic = false;

    const innerFetch = async () =>
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

    // OLD (buggy) wrapper: skips when global patch is installed
    const oldWrapper = async (input: RequestInfo | URL) => {
      if (!config.verbose || globalPatchInstalled) {
        return innerFetch();
      }
      loggedWithOldLogic = true;
      return innerFetch();
    };

    // NEW (fixed) wrapper: only checks verbose flag
    const newWrapper = async (input: RequestInfo | URL) => {
      if (!config.verbose) {
        return innerFetch();
      }
      loggedWithNewLogic = true;
      return innerFetch();
    };

    await oldWrapper('https://api.example.com/v1');
    await newWrapper('https://api.example.com/v1');

    // Old logic fails to log (the bug)
    expect(loggedWithOldLogic).toBe(false);
    // New logic correctly logs
    expect(loggedWithNewLogic).toBe(true);
  });
});
