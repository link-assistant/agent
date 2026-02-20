import { test, expect, describe, setDefaultTimeout } from 'bun:test';

/**
 * Tests for verbose HTTP request/response logging in --verbose mode.
 *
 * Issue #200: Models not working — insufficient debug output.
 * When --verbose is enabled, all HTTP requests to LLM providers should be
 * logged as JSON with request URL, method, sanitized headers, body preview,
 * response status, and timing.
 *
 * @see https://github.com/link-assistant/agent/issues/200
 */

setDefaultTimeout(90000);

describe('Verbose HTTP logging', () => {
  const projectRoot = process.cwd();

  test('--verbose mode logs HTTP request and response details', async () => {
    // Run the agent with --verbose and a fake API key
    // The request will fail (bad key) but we should see HTTP logging
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
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-fake-key-for-verbose-test',
        OPENCODE_VERBOSE: '1',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // Verbose mode should log HTTP request details
    // The log should contain "HTTP request" or "HTTP response" entries
    const hasHttpRequest =
      output.includes('HTTP request') ||
      output.includes('"message":"HTTP request"');
    const hasHttpResponse =
      output.includes('HTTP response') ||
      output.includes('"message":"HTTP response"') ||
      output.includes('HTTP request failed') ||
      output.includes('"message":"HTTP request failed"');

    // At least one HTTP interaction should be logged
    // (even if the API call fails due to fake key)
    expect(hasHttpRequest || hasHttpResponse).toBe(true);
  });

  test('--verbose mode sanitizes API keys in logged headers', async () => {
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
        GOOGLE_GENERATIVE_AI_API_KEY: 'sk-super-secret-key-12345',
        OPENCODE_VERBOSE: '1',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // The full API key should NOT appear in the output
    expect(output).not.toContain('sk-super-secret-key-12345');
  });

  test('model not found error includes available models', async () => {
    // Use an explicit provider with a non-existent model
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        `${projectRoot}/src/index.js`,
        '--model',
        'google/non-existent-model-xyz',
        '--verbose',
      ],
      stdin: new Blob(['{"message":"hi"}']),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-fake-key',
        OPENCODE_VERBOSE: '1',
      },
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const output = stdoutText + stderrText;
    await proc.exited;

    // Should contain model not found error with suggestion
    const hasModelNotFound =
      output.includes('ProviderModelNotFoundError') ||
      output.includes('not found in provider') ||
      output.includes('Available models');

    expect(hasModelNotFound).toBe(true);
  });
});
