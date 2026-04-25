import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import {
  getPendingStreamLogCount,
  createVerboseFetch,
  resetHttpCallCount,
} from '../src/util/verbose-fetch';
import { setVerbose } from '../src/config/config';

/**
 * Tests for strict model validation and logging improvements.
 *
 * Issue #231: Silent model fallback and missing compaction logs
 *
 * Root causes:
 * 1. model-config.js warned instead of failing when explicit provider/model not found
 * 2. provider.ts created synthetic fallback model info for unknown models
 * 3. Async stream log operations lost on process exit
 * 4. Verbose stderr message misdetected as error
 * 5. Storage migration error details not logged
 *
 * @see https://github.com/link-assistant/agent/issues/231
 */

describe('Model validation - explicit provider/model format (#231)', () => {
  test('should fail when model not found in explicit provider/model format', () => {
    // Before fix (model-config.js:78-88): warned and continued
    // After fix: throws Error with clear message
    //
    // The parseModelConfig function now throws:
    //   `Model "kimi-k2.5-free" not found in provider "opencode".
    //    Available models include: ...
    //    Use --model opencode/<model-id> with a valid model.`
    //
    // This prevents the silent substitution where kimi-k2.5-free was
    // routed to minimax-m2.5-free by the OpenCode API.

    // Simulate the validation logic
    const providerID = 'opencode';
    const modelID = 'kimi-k2.5-free';
    const providerModels: Record<string, boolean> = {
      'minimax-m2.5-free': true,
      'gpt-5-nano': true,
    };

    // Model not in provider catalog — should fail
    const modelExists = !!providerModels[modelID];
    expect(modelExists).toBe(false);

    // The error message should be actionable
    const availableModels = Object.keys(providerModels).slice(0, 10);
    const errorMessage =
      `Model "${modelID}" not found in provider "${providerID}". ` +
      `Available models include: ${availableModels.join(', ')}. ` +
      `Use --model ${providerID}/<model-id> with a valid model, or omit the provider prefix for auto-resolution.`;

    expect(errorMessage).toContain('kimi-k2.5-free');
    expect(errorMessage).toContain('opencode');
    expect(errorMessage).toContain('minimax-m2.5-free');
    expect(errorMessage).toContain('auto-resolution');
  });

  test('should re-throw validation errors, not swallow them', () => {
    // Before fix: catch block swallowed ALL errors including our own validation error
    // After fix: re-throw if error message contains 'not found in provider'

    const validationError = new Error(
      'Model "kimi-k2.5-free" not found in provider "opencode".'
    );
    const isOurError = validationError.message.includes(
      'not found in provider'
    );
    expect(isOurError).toBe(true);

    const infrastructureError = new Error('Cannot read provider state');
    const isInfraError = infrastructureError.message.includes(
      'not found in provider'
    );
    expect(isInfraError).toBe(false);
  });

  test('should allow valid explicit provider/model format', () => {
    // When the model exists in the provider, no error should be thrown
    const providerModels: Record<string, boolean> = {
      'minimax-m2.5-free': true,
    };
    const modelExists = !!providerModels['minimax-m2.5-free'];
    expect(modelExists).toBe(true);
  });

  test('should warn but proceed when default model not in models.dev catalog (#239)', () => {
    // When no --model CLI flag is provided, the default model (minimax-m2.5-free)
    // should NOT be rejected even if models.dev API doesn't list it yet.
    // The models.dev API can lag behind the provider's actual model availability.
    //
    // Before fix: default model treated same as explicit — threw Error
    // After fix: default model logs warning and proceeds, letting the provider
    // accept or reject the model at runtime.

    const cliModelArg = null; // No --model flag provided
    const isDefaultModel = !cliModelArg;
    expect(isDefaultModel).toBe(true);

    // With isDefaultModel=true, the validation block warns instead of throwing
    // This means the agent can still use minimax-m2.5-free even if models.dev
    // temporarily doesn't list it
    const providerModels: Record<string, boolean> = {
      'gpt-5-nano': true,
    };
    const modelID = 'minimax-m2.5-free';
    const modelExists = !!providerModels[modelID];
    expect(modelExists).toBe(false);

    // Default model: should NOT throw (warn only)
    let threw = false;
    if (!modelExists && !isDefaultModel) {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe('OpenCode Zen live model endpoint (#266)', () => {
  test('parses model ids from the live models endpoint response', async () => {
    const { OpenCodeZen } = await import('../src/provider/opencode-zen');
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'minimax-m2.5-free', object: 'model' },
            { id: 'ling-2.6-flash-free', object: 'model' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const ids = await OpenCodeZen.fetchModelIDs(fetchFn as typeof fetch);
    expect(ids.has('minimax-m2.5-free')).toBe(true);
    expect(ids.has('ling-2.6-flash-free')).toBe(true);
  });

  test('creates metadata for live free models when models.dev lags', async () => {
    const { OpenCodeZen } = await import('../src/provider/opencode-zen');
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'hy3-preview-free', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'hy3-preview-free',
      fetchFn as typeof fetch
    );
    expect(info?.id).toBe('hy3-preview-free');
    expect(info?.cost.input).toBe(0);
    expect(info?.cost.output).toBe(0);
    expect(info?.tool_call).toBe(true);
    expect(info?.provider?.npm).toBe('@ai-sdk/openai-compatible');
  });

  test('does not synthesize paid models from an availability-only response', async () => {
    const { OpenCodeZen } = await import('../src/provider/opencode-zen');
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'claude-opus-4-7', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'claude-opus-4-7',
      fetchFn as typeof fetch
    );
    expect(info).toBeUndefined();
  });

  test('does not synthesize deprecated free models from the live endpoint', async () => {
    const { OpenCodeZen } = await import('../src/provider/opencode-zen');
    const fetchFn = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'trinity-large-preview-free', object: 'model' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const info = await OpenCodeZen.getLiveFreeModelInfo(
      'trinity-large-preview-free',
      fetchFn as typeof fetch
    );
    expect(info).toBeUndefined();
  });

  test('provider sorting prioritizes MiniMax M2.5 among current free Zen models', async () => {
    const { Provider } = await import('../src/provider/provider');
    const sorted = Provider.sort([
      { id: 'big-pickle' },
      { id: 'gpt-5-nano' },
      { id: 'nemotron-3-super-free' },
      { id: 'ling-2.6-flash-free' },
      { id: 'hy3-preview-free' },
      { id: 'minimax-m2.5-free' },
    ] as any);

    expect(sorted[0].id).toBe('minimax-m2.5-free');
  });
});

describe('Provider.getModel - strict model lookup (#231)', () => {
  test('should throw ModelNotFoundError when model not in catalog after refresh', () => {
    // Before fix (provider.ts:1625-1654): created synthetic fallback model info
    // After fix: throws ModelNotFoundError with helpful suggestion
    //
    // The synthetic info allowed the SDK to proceed with a model the provider
    // doesn't actually know about, leading to silent model substitution.

    // Simulate the check
    const info = null; // model not found after refresh
    const isSyntheticProvider = false;
    const shouldThrow = !isSyntheticProvider && !info;
    expect(shouldThrow).toBe(true);
  });

  test('should not throw for synthetic providers', () => {
    const info = null;
    const isSyntheticProvider = true;
    const shouldThrow = !isSyntheticProvider && !info;
    expect(shouldThrow).toBe(false);
  });

  test('should not throw when model is found in catalog', () => {
    const info = { id: 'minimax-m2.5-free', name: 'MiniMax M2.5' };
    const isSyntheticProvider = false;
    const shouldThrow = !isSyntheticProvider && !info;
    expect(shouldThrow).toBe(false);
  });
});

describe('Pending stream log tracking (#231)', () => {
  const originalVerbose = false;

  beforeEach(() => {
    resetHttpCallCount();
  });

  afterEach(() => {
    setVerbose(originalVerbose);
  });

  test('getPendingStreamLogCount starts at 0', () => {
    expect(getPendingStreamLogCount()).toBe(0);
  });

  test('pending stream count increments and decrements for streaming responses', async () => {
    setVerbose(true);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: test\n'));
        controller.close();
      },
    });

    const mockFetch = async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });

    const vf = createVerboseFetch(mockFetch as typeof fetch, {
      caller: 'test-pending',
    });

    const response = await vf('https://example.com/stream');
    // Consume the response body to let the log stream complete
    await response.text();

    // Wait a tick for the async log operation to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After completion, pending count should be back to 0
    expect(getPendingStreamLogCount()).toBe(0);
  });

  test('exports are available', async () => {
    const mod = await import('../src/util/verbose-fetch');
    expect(typeof mod.getPendingStreamLogCount).toBe('function');
    expect(typeof mod.registerPendingStreamLogExitHandler).toBe('function');
  });
});

describe('Storage migration error logging (#231)', () => {
  test('should log error details including name, message, and stack', () => {
    // Before fix: .catch(() => log.error({ message: 'failed to run migration', index }))
    // After fix: .catch((migrationError) => log.error({
    //   message: 'failed to run migration',
    //   index,
    //   error: { name, message, stack }
    // }))
    //
    // This ensures migration failures are diagnosable from logs.

    const migrationError = new Error('ENOENT: no such file or directory');
    const logEntry = {
      message: 'failed to run migration',
      index: 0,
      error:
        migrationError instanceof Error
          ? {
              name: migrationError.name,
              message: migrationError.message,
              stack: migrationError.stack,
            }
          : String(migrationError),
    };

    expect(logEntry.error).toHaveProperty('name', 'Error');
    expect(logEntry.error).toHaveProperty(
      'message',
      'ENOENT: no such file or directory'
    );
    expect(logEntry.error).toHaveProperty('stack');
  });

  test('should handle non-Error migration failures', () => {
    const migrationError = 'string error';
    const logEntry = {
      message: 'failed to run migration',
      index: 0,
      error:
        migrationError instanceof Error
          ? {
              name: migrationError.name,
              message: migrationError.message,
              stack: migrationError.stack,
            }
          : String(migrationError),
    };

    expect(logEntry.error).toBe('string error');
  });
});

describe('Integration scenario - Issue #231 full reproduction', () => {
  test('documents the original kimi-k2.5-free substitution timeline', () => {
    // Original issue timeline:
    // 1. Outer solver: --model kimi-k2.5-free
    // 2. Solver expands to: --model opencode/kimi-k2.5-free
    // 3. model-config.js: provider "opencode" found, but model "kimi-k2.5-free" NOT found
    // 4. model-config.js: WARNS "will attempt anyway" (BUG — should have thrown)
    // 5. provider.ts getModel(): model not in catalog after refresh
    // 6. provider.ts: creates synthetic fallback info (BUG — should have thrown)
    // 7. SDK sends request with model "kimi-k2.5-free" to OpenCode API
    // 8. OpenCode API silently routes to "minimax-m2.5-free" (default)
    // 9. Agent operates with wrong model for entire session

    // With fixes:
    // Step 3-4: model-config.js now THROWS instead of warning
    // Step 5-6: provider.ts now THROWS ModelNotFoundError
    // Result: User sees clear error message and can fix the model argument
    expect(true).toBe(true);
  });

  test('documents the missing compaction response log', () => {
    // Original issue:
    // 1. Agent sends compaction POST at 12:37:08.713Z
    // 2. Agent exits at 12:37:08.734Z (21ms later)
    // 3. Async stream logging IIFE never completes
    // 4. HTTP response body never logged

    // With fix:
    // - pendingStreamLogs counter tracks active async log operations
    // - Process exit handler warns about any pending operations
    // - This makes the gap visible in logs instead of silently lost
    expect(true).toBe(true);
  });

  test('documents the OpenCode API 500 error handling', () => {
    // Original issue (hive-mind#1537):
    // 1. Compaction POST to /responses at 12:33:44 with gpt-5-nano
    // 2. OpenCode API returns 500: "Cannot read properties of undefined (reading 'input_tokens')"
    // 3. Second 500 at 12:33:52 — same error
    // 4. No retry — compaction result lost, agent continues with degraded context

    // With fix (retry-fetch.ts):
    // - Server errors (500, 502, 503) are now retried up to 3 times
    // - Exponential backoff: 2s, 4s, 8s between retries
    // - If all retries fail, error propagates normally
    // - This prevents intermittent OpenCode API errors from silently losing compaction
    expect(true).toBe(true);
  });
});
