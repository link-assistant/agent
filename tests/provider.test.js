import { test, expect, describe, setDefaultTimeout } from 'bun:test';

// Increase default timeout
setDefaultTimeout(90000);

/**
 * Test suite for provider initialization - Issue #61
 * Tests that providers with multiple env variable options are correctly loaded
 */
describe('Provider initialization with multiple env vars', () => {
  const projectRoot = process.cwd();

  test('Google provider loads with GEMINI_API_KEY env var', async () => {
    // This tests the fix for issue #61
    // Google provider has two possible env vars:
    // - GOOGLE_GENERATIVE_AI_API_KEY
    // - GEMINI_API_KEY
    // Before the fix, setting only GEMINI_API_KEY would not work

    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        `${projectRoot}/src/index.js`,
        '--model',
        'google/gemini-3-pro',
        '--verbose',
      ],
      stdin: new Blob(['{"message":"hi"}']),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GEMINI_API_KEY: 'test-fake-key',
        GOOGLE_GENERATIVE_AI_API_KEY: '', // Explicitly unset
        OPENCODE_VERBOSE: '1',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // The provider should be found (even if the API call fails due to invalid key)
    // Before the fix: "ProviderModelNotFoundError"
    // After the fix: The provider is loaded, API call fails with "API key not valid"

    // Check that we don't get ModelNotFoundError
    expect(output).not.toContain('ProviderModelNotFoundError');

    // The provider should attempt to load the model
    // Either succeeds or fails with authentication error (not with "model not found")
    const hasGoogleProviderFound = output.includes('providerID=google found');
    const hasApiKeyError =
      output.includes('API key not valid') ||
      output.includes('API key is invalid') ||
      output.includes('Invalid API key');

    // The provider should be found (and may fail with API key error which is expected)
    expect(hasGoogleProviderFound || hasApiKeyError).toBe(true);
  });

  test('Google provider loads with GOOGLE_GENERATIVE_AI_API_KEY env var', async () => {
    // This tests that the original env var still works
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        `${projectRoot}/src/index.js`,
        '--model',
        'google/gemini-3-pro',
        '--verbose',
      ],
      stdin: new Blob(['{"message":"hi"}']),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-fake-key',
        GEMINI_API_KEY: '', // Explicitly unset
        OPENCODE_VERBOSE: '1',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // Check that we don't get ModelNotFoundError
    expect(output).not.toContain('ProviderModelNotFoundError');

    // The provider should be found
    const hasGoogleProviderFound = output.includes('providerID=google found');
    const hasApiKeyError =
      output.includes('API key not valid') ||
      output.includes('API key is invalid') ||
      output.includes('Invalid API key');

    expect(hasGoogleProviderFound || hasApiKeyError).toBe(true);
  });

  test('Google provider not loaded without any API key', async () => {
    // This tests that the provider correctly does not load when no API key is set
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        `${projectRoot}/src/index.js`,
        '--model',
        'google/gemini-3-pro',
      ],
      stdin: new Blob(['{"message":"hi"}']),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GOOGLE_GENERATIVE_AI_API_KEY: '',
        GEMINI_API_KEY: '',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // Should get ModelNotFoundError when no API key is set
    expect(output).toContain('ProviderModelNotFoundError');
  });
});
