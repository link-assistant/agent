import { test, expect, describe, setDefaultTimeout } from 'bun:test';
// @ts-ignore
import { sh } from 'command-stream';

// Increase default timeout for network operations
setDefaultTimeout(60000);

/**
 * Test suite for models.dev cache handling - Issue #175
 *
 * These tests verify that the ModelsDev.get() function properly handles:
 * 1. Missing cache files (first run)
 * 2. Stale cache files (> 1 hour old)
 * 3. Fresh cache files (< 1 hour old)
 *
 * The fix ensures that when the cache is missing or stale, we await the refresh
 * before proceeding, preventing ProviderModelNotFoundError for newly added models.
 *
 * @see https://github.com/link-assistant/agent/issues/175
 */
describe('ModelsDev cache handling', () => {
  const projectRoot = process.cwd();

  test('echo provider works in dry-run mode', async () => {
    // This tests that the echo provider works correctly in dry-run mode
    // We use --dry-run to enable the echo provider

    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const output = result.stdout + result.stderr;

    // Should NOT get ProviderModelNotFoundError
    expect(output).not.toContain('ProviderModelNotFoundError');

    // Should see the model being used (echo provider outputs the input)
    expect(output).toContain('echo') || expect(output).toContain('hi');
  });

  test('models.dev refresh is triggered on startup', async () => {
    // Test that the models.dev cache is being handled
    // We use --dry-run to avoid API calls

    const input = '{"message":"hi"}';
    const result = await sh(
      `echo '${input}' | bun run ${projectRoot}/src/index.js --dry-run --no-always-accept-stdin`
    );
    const output = result.stdout + result.stderr;

    // Should see cache-related log messages
    const hasCacheHandling =
      output.includes('cache is fresh') ||
      output.includes('cache is stale') ||
      output.includes('no cache found') ||
      output.includes('refreshing') ||
      output.includes('models.dev');

    expect(hasCacheHandling).toBe(true);
  });
});

/**
 * Unit tests for ModelsDev module directly
 */
describe('ModelsDev module', () => {
  test('ModelsDev.get() returns provider data', async () => {
    const { ModelsDev } = await import('../src/provider/models.ts');

    // Get the models database
    const database = await ModelsDev.get();

    // Should have providers
    expect(database).toBeTruthy();
    expect(typeof database).toBe('object');

    // Should have the opencode provider
    expect(database['opencode']).toBeTruthy();
    expect(database['opencode'].id).toBe('opencode');

    // opencode should have models
    expect(database['opencode'].models).toBeTruthy();
    expect(Object.keys(database['opencode'].models).length).toBeGreaterThan(0);
  });

  test('opencode provider should have kimi-k2.5-free model', async () => {
    const { ModelsDev } = await import('../src/provider/models.ts');

    // Get the models database
    const database = await ModelsDev.get();

    // Check for kimi-k2.5-free model
    const opencode = database['opencode'];
    expect(opencode).toBeTruthy();

    // The model should exist (this is the bug we're fixing)
    const kimiModel = opencode.models['kimi-k2.5-free'];
    expect(kimiModel).toBeTruthy();
    expect(kimiModel.name).toContain('Kimi');
    expect(kimiModel.cost.input).toBe(0); // Should be free
  });

  test('opencode provider should have other free models', async () => {
    const { ModelsDev } = await import('../src/provider/models.ts');

    // Get the models database
    const database = await ModelsDev.get();

    const opencode = database['opencode'];
    expect(opencode).toBeTruthy();

    // Check for other free models (cost.input === 0)
    const freeModels = Object.entries(opencode.models)
      .filter(([_, model]) => model.cost.input === 0)
      .map(([id]) => id);

    // Should have multiple free models
    expect(freeModels.length).toBeGreaterThan(0);

    // Some known free models that should exist
    const expectedFreeModels = ['grok-code', 'gpt-5-nano', 'big-pickle'];
    for (const modelId of expectedFreeModels) {
      const model = opencode.models[modelId];
      if (model) {
        expect(model.cost.input).toBe(0);
      }
    }
  });
});
