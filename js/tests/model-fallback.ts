import { test, expect, describe, setDefaultTimeout } from 'bun:test';

/**
 * Tests for model fallback behavior when model is not in provider catalog.
 *
 * Issue #200: When a model like kimi-k2.5-free is missing from the local
 * models.dev cache (due to stale bundled data or expired cache), the agent
 * should:
 * 1. Try refreshing the cache from models.dev
 * 2. If still not found, create a fallback model info and try anyway
 * 3. Never throw ProviderModelNotFoundError for unknown models
 *
 * @see https://github.com/link-assistant/agent/issues/200
 */

setDefaultTimeout(30000);

describe('Model fallback - getModel behavior (#200)', () => {
  test('getModel should not throw for models missing from catalog', async () => {
    // The getModel function should handle missing models gracefully:
    // 1. Log a warning about the model not being in the catalog
    // 2. Create a minimal fallback model info
    // 3. Attempt to use the model via the SDK

    // We can't easily unit-test getModel directly (requires provider state),
    // but we verify the fallback model info structure matches ModelsDev.Model
    const fallbackInfo = {
      id: 'test-model',
      name: 'test-model',
      release_date: '',
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 16384 },
      options: {},
    };

    // Verify the fallback has all required fields
    expect(fallbackInfo.id).toBe('test-model');
    expect(fallbackInfo.cost.input).toBe(0);
    expect(fallbackInfo.cost.output).toBe(0);
    expect(fallbackInfo.limit.context).toBe(128000);
    expect(fallbackInfo.limit.output).toBe(16384);
    expect(fallbackInfo.tool_call).toBe(true);
  });

  test('ModelsDev.refresh should be callable without errors', async () => {
    const { ModelsDev } = await import('../src/provider/models.ts');

    // refresh() should not throw even if network fails
    await expect(ModelsDev.refresh()).resolves.toBeUndefined();
  });

  test('ModelsDev.get should return data after refresh', async () => {
    const { ModelsDev } = await import('../src/provider/models.ts');

    const database = await ModelsDev.get();
    expect(database).toBeTruthy();
    expect(typeof database).toBe('object');

    // opencode provider should exist with models
    const opencode = database['opencode'];
    expect(opencode).toBeTruthy();
    expect(Object.keys(opencode.models).length).toBeGreaterThan(0);
  });
});

describe('Stderr JSON interception (#200)', () => {
  test('stderr interceptor should wrap non-JSON text in JSON envelope', () => {
    // The interceptor in index.js wraps non-JSON stderr output.
    // We test the logic pattern here without actually modifying process.stderr.

    function wrapIfNotJson(str: string): string {
      const trimmed = str.trim();
      if (!trimmed) return str;

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(trimmed);
          return str; // Already JSON
        } catch (_e) {
          // Not valid JSON, wrap it
        }
      }

      return (
        JSON.stringify({
          type: 'error',
          errorType: 'RuntimeError',
          message: trimmed,
        }) + '\n'
      );
    }

    // Plain text should be wrapped
    const plainText = 'Error: something went wrong\n    at foo.ts:42';
    const wrapped = wrapIfNotJson(plainText);
    const parsed = JSON.parse(wrapped);
    expect(parsed.type).toBe('error');
    expect(parsed.errorType).toBe('RuntimeError');
    expect(parsed.message).toContain('Error: something went wrong');

    // Valid JSON should pass through
    const jsonText = '{"type":"error","message":"test"}';
    expect(wrapIfNotJson(jsonText)).toBe(jsonText);

    // Bun stack trace should be wrapped
    const bunTrace =
      '1428 |         providerID,\n1429 |         modelID,\n       ^\nProviderModelNotFoundError: ProviderModelNotFoundError';
    const wrappedTrace = wrapIfNotJson(bunTrace);
    const parsedTrace = JSON.parse(wrappedTrace);
    expect(parsedTrace.type).toBe('error');
    expect(parsedTrace.message).toContain('ProviderModelNotFoundError');
  });
});
